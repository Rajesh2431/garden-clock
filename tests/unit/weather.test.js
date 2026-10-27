import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCATION,
  KIND_LABELS,
  WEATHER_CACHE_KEY,
  WEATHER_CACHE_TTL,
  fetchWeather,
  fetchWeatherCached,
  geocode,
  kindOf,
  label,
  locate,
  readWeatherCache,
  searchCities,
  writeWeatherCache,
} from '../../js/weather.js';

const payload = () => ({
  timezone: 'Asia/Tokyo',
  utc_offset_seconds: 32400,
  current: {
    temperature_2m: 21.6,
    apparent_temperature: 20.4,
    relative_humidity_2m: 66.4,
    precipitation: 0.2,
    weather_code: 61,
    wind_speed_10m: 12.6,
    wind_direction_10m: 190.4,
    is_day: 1,
  },
  daily: {
    sunrise: ['2026-10-27T05:57'],
    sunset: ['2026-10-27T16:51'],
  },
});

const jsonResponse = (value) => ({
  ok: true,
  status: 200,
  json: async () => value,
  text: async () => JSON.stringify(value),
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WMO code mapping', () => {
  it.each([
    [0, 'clear'],
    [1, 'clear'],
    [2, 'cloud'],
    [3, 'cloud'],
    [45, 'fog'],
    [48, 'fog'],
    [51, 'rain'],
    [61, 'rain'],
    [66, 'rain'],
    [67, 'rain'],
    [80, 'rain'],
    [82, 'rain'],
    [71, 'snow'],
    [73, 'snow'],
    [77, 'snow'],
    [85, 'snow'],
    [86, 'snow'],
    [95, 'storm'],
    [96, 'storm'],
    [99, 'storm'],
  ])('maps %i to %s', (code, kind) => {
    expect(kindOf(code)).toBe(kind);
  });

  it('falls back to cloud for unknown and non-numeric codes', () => {
    expect(kindOf(68)).toBe('cloud');
    expect(kindOf(79)).toBe('cloud');
    expect(kindOf('abc')).toBe('cloud');
    expect(kindOf(null)).toBe('cloud');
  });

  it('labels known and unknown weather', () => {
    expect(label(0)).toBe('Clear sky');
    expect(label(61)).toBe('Light rain');
    expect(label(95)).toBe('Thunderstorm');
    expect(label(1234)).toBe('Unknown weather');
    expect(KIND_LABELS.storm).toBe('Thunderstorm');
  });
});

describe('fetchWeather', () => {
  it('normalises the Open-Meteo response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(payload()));
    const weather = await fetchWeather(35.68, 139.69, { fetchImpl, timeoutMs: 0 });

    expect(weather).toMatchObject({
      temp: 22,
      apparent: 20,
      humidity: 66,
      precip: 0.2,
      wind: 13,
      windDir: 190,
      code: 61,
      isDay: true,
      tz: 'Asia/Tokyo',
      utcOffset: 32400,
      sunrise: '2026-10-27T05:57',
      sunset: '2026-10-27T16:51',
    });

    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get('latitude')).toBe('35.68');
    expect(url.searchParams.get('longitude')).toBe('139.69');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('current')).toContain('weather_code');
  });

  it('maps is_day 0 to night', async () => {
    const data = payload();
    data.current.is_day = 0;
    const weather = await fetchWeather(1, 2, {
      fetchImpl: async () => jsonResponse(data),
      timeoutMs: 0,
    });
    expect(weather.isDay).toBe(false);
  });

  it('throws when current conditions are missing', async () => {
    await expect(
      fetchWeather(1, 2, {
        fetchImpl: async () => jsonResponse({ timezone: 'UTC' }),
        timeoutMs: 0,
      }),
    ).rejects.toThrow(/current conditions/i);
  });

  it('throws on an unsuccessful response', async () => {
    await expect(
      fetchWeather(1, 2, {
        fetchImpl: async () => ({ ok: false, status: 503 }),
        timeoutMs: 0,
      }),
    ).rejects.toThrow('HTTP 503');
  });
});

describe('city search', () => {
  const results = {
    results: [
      {
        id: 1,
        name: 'New York',
        latitude: 40.71,
        longitude: -74.01,
        country_code: 'US',
        country: 'United States',
        admin1: 'New York',
        timezone: 'America/New_York',
      },
      {
        id: 2,
        name: 'New York',
        latitude: 41.2,
        longitude: -75.0,
        country_code: 'US',
        admin1: 'Pennsylvania',
        timezone: 'America/New_York',
      },
    ],
  };

  it('searches with the right query and maps the results', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(results));
    const cities = await searchCities('New York', { fetchImpl, timeoutMs: 0 });

    expect(cities).toHaveLength(2);
    expect(cities[0]).toMatchObject({
      id: 1,
      lat: 40.71,
      lon: -74.01,
      name: 'New York',
      label: 'New York, New York, US',
      timezone: 'America/New_York',
    });
    const url = fetchImpl.mock.calls[0][0];
    expect(url).toContain('name=New%20York');
    expect(url).toContain('count=5');
  });

  it('skips the request for very short queries', async () => {
    const fetchImpl = vi.fn();
    await expect(searchCities(' a ', { fetchImpl })).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('geocode returns the first match only', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(results));
    const city = await geocode('New York', { fetchImpl, timeoutMs: 0 });
    expect(city.name).toBe('New York');
    expect(fetchImpl.mock.calls[0][0]).toContain('count=1');
  });

  it('returns an empty list when the API has no results', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(searchCities('Nowhere', { fetchImpl, timeoutMs: 0 })).resolves.toEqual([]);
  });
});

describe('weather cache', () => {
  it('round-trips a cached reading', () => {
    const storage = memoryStorage();
    writeWeatherCache(13.08, 80.27, { temp: 31, code: 1 }, storage, 1234);
    expect(readWeatherCache(storage)).toEqual({
      weather: { temp: 31, code: 1 },
      at: 1234,
      lat: 13.08,
      lon: 80.27,
    });
  });

  it('ignores corrupt cache entries', () => {
    const storage = memoryStorage();
    storage.setItem(WEATHER_CACHE_KEY, '{not json');
    expect(readWeatherCache(storage)).toBeNull();
    storage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ at: 1, lat: 1, lon: 2 }));
    expect(readWeatherCache(storage)).toBeNull();
  });

  it('returns fresh cached weather without touching the network', async () => {
    const storage = memoryStorage();
    writeWeatherCache(13.08, 80.27, { temp: 31, code: 0 }, storage, 1000);
    const fetchImpl = vi.fn();

    const weather = await fetchWeatherCached(13.08, 80.27, {
      storage,
      fetchImpl,
      nowMs: () => 1500,
      maxAgeMs: 1000,
      timeoutMs: 0,
    });

    expect(weather).toMatchObject({ temp: 31, cached: true, fetchedAt: 1000 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshes a stale cache and stores the new reading', async () => {
    const storage = memoryStorage();
    writeWeatherCache(13.08, 80.27, { temp: 20, code: 0 }, storage, 1000);
    const fetchImpl = vi.fn(async () => jsonResponse(payload()));

    const weather = await fetchWeatherCached(13.08, 80.27, {
      storage,
      fetchImpl,
      nowMs: () => 5000,
      maxAgeMs: 1000,
      timeoutMs: 0,
    });

    expect(weather.temp).toBe(22);
    expect(weather.cached).toBe(false);
    expect(weather.fetchedAt).toBe(5000);
    expect(readWeatherCache(storage)?.weather.temp).toBe(22);
    expect(readWeatherCache(storage)?.at).toBe(5000);
  });

  it('falls back to the last reading when the network fails', async () => {
    const storage = memoryStorage();
    writeWeatherCache(13.08, 80.27, { temp: 24, code: 3 }, storage, 1000);

    const weather = await fetchWeatherCached(13.08, 80.27, {
      storage,
      fetchImpl: async () => {
        throw new Error('offline');
      },
      nowMs: () => 5000,
      maxAgeMs: 1000,
      timeoutMs: 0,
    });

    expect(weather).toMatchObject({
      temp: 24,
      cached: true,
      stale: true,
      fetchedAt: 1000,
      error: 'offline',
    });
  });

  it('throws when the cache belongs to a different place', async () => {
    const storage = memoryStorage();
    writeWeatherCache(13.08, 80.27, { temp: 24 }, storage, 1000);

    await expect(
      fetchWeatherCached(51.5, -0.12, {
        storage,
        fetchImpl: async () => {
          throw new Error('offline');
        },
        nowMs: () => 5000,
        timeoutMs: 0,
      }),
    ).rejects.toThrow('offline');
  });

  it('uses the default TTL and location constants', () => {
    expect(WEATHER_CACHE_TTL).toBe(10 * 60 * 1000);
    expect(DEFAULT_LOCATION).toMatchObject({
      name: 'Chennai',
      timezone: 'Asia/Kolkata',
    });
  });
});

describe('locate', () => {
  function setGeolocation(value) {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value,
    });
  }

  afterEach(() => {
    delete navigator.geolocation;
  });

  it('resolves null when geolocation is unavailable', async () => {
    setGeolocation(undefined);
    await expect(locate()).resolves.toBeNull();
  });

  it('wraps a successful position', async () => {
    setGeolocation({
      getCurrentPosition(success) {
        success({ coords: { latitude: 12.97, longitude: 77.59 } });
      },
    });

    const result = await locate({ timeoutMs: 50 });
    expect(result).toMatchObject({
      lat: 12.97,
      lon: 77.59,
      name: 'Your location',
      geolocation: true,
    });
    expect(result.timezone).toBeTruthy();
  });

  it('resolves null when permission is denied', async () => {
    setGeolocation({
      getCurrentPosition(_success, failure) {
        failure({ code: 1 });
      },
    });

    await expect(locate({ timeoutMs: 50 })).resolves.toBeNull();
  });

  it('times out without a browser response', async () => {
    vi.useFakeTimers();
    setGeolocation({ getCurrentPosition: vi.fn() });

    const promise = locate({ timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(400);
    await expect(promise).resolves.toBeNull();
  });
});
