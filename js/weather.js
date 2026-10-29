// Open-Meteo (key-free) weather, geocoding, saved-city cache and fallbacks.

export const WEATHER_CACHE_KEY = 'garden-clock:weather:v1';
export const WEATHER_CACHE_TTL = 10 * 60 * 1000;
export const DEFAULT_LOCATION = {
  lat: 13.0827,
  lon: 80.2707,
  name: 'Chennai',
  label: 'Chennai, Tamil Nadu, IN',
  timezone: 'Asia/Kolkata',
};

export const KIND_LABELS = {
  clear: 'Clear',
  cloud: 'Cloudy',
  fog: 'Fog',
  rain: 'Rain',
  storm: 'Thunderstorm',
  snow: 'Snow',
};

const WEATHER_LABELS = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Rain showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm',
};

export function label(code) {
  return WEATHER_LABELS[code] || 'Unknown weather';
}

export function kindOf(code) {
  if (code === null || code === undefined || code === '') return 'cloud';
  const c = Number(code);
  if (!Number.isFinite(c)) return 'cloud';
  if (c <= 1) return 'clear';
  if (c <= 3) return 'cloud';
  if (c === 45 || c === 48) return 'fog';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'storm';
  return 'cloud';
}

function buildWeatherUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
    daily: 'sunrise,sunset',
    timezone: 'auto',
    forecast_days: '1',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

async function fetchJson(url, options = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 9000, signal, init = {} } = options;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...init,
      signal: controller.signal,
    });
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'error'}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export async function fetchWeather(lat, lon, options = {}) {
  const payload = await fetchJson(buildWeatherUrl(lat, lon), options);
  const current = payload?.current;
  if (!current || typeof current.temperature_2m !== 'number') {
    throw new Error('Weather response did not include current conditions');
  }
  const daily = payload.daily || {};
  return {
    temp: Math.round(current.temperature_2m),
    apparent: Math.round(current.apparent_temperature ?? current.temperature_2m),
    humidity: Math.round(current.relative_humidity_2m ?? 0),
    precip: Number(current.precipitation ?? 0),
    wind: Math.round(current.wind_speed_10m ?? 0),
    windDir: Math.round(current.wind_direction_10m ?? 0),
    code: Number(current.weather_code ?? 0),
    isDay: current.is_day === 1 || current.is_day === true,
    tz: payload.timezone || '',
    utcOffset: Number(payload.utc_offset_seconds ?? 0),
    sunrise: daily.sunrise?.[0] || '',
    sunset: daily.sunset?.[0] || '',
  };
}

function cityFromResult(result) {
  if (!result) return null;
  return {
    id: result.id,
    lat: Number(result.latitude),
    lon: Number(result.longitude),
    name: result.name,
    label: [result.name, result.admin1, result.country_code || result.country].filter(Boolean).join(', '),
    admin1: result.admin1 || '',
    country: result.country || '',
    countryCode: result.country_code || '',
    timezone: result.timezone || '',
  };
}

export async function searchCities(query, options = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const count = options.count || 5;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${count}&language=en&format=json`;
  const payload = await fetchJson(url, options);
  return Array.isArray(payload?.results) ? payload.results.map(cityFromResult).filter(Boolean) : [];
}

export async function geocode(query, options = {}) {
  const results = await searchCities(query, { ...options, count: 1 });
  return results[0] || null;
}

export function locate(options = {}) {
  const timeout = options.timeoutMs ?? 6000;
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeout + 250);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        done({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          name: 'Your location',
          label: 'Your location',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          geolocation: true,
        });
      },
      () => {
        clearTimeout(timer);
        done(null);
      },
      { timeout, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false },
    );
  });
}

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readWeatherCache(storage) {
  const backend = safeStorage(storage);
  if (!backend) return null;
  try {
    const raw = backend.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const weather = cached?.weather || cached?.w;
    if (!cached || !weather || typeof weather !== 'object') return null;
    return {
      weather,
      at: Number(cached.at) || 0,
      lat: Number(cached.lat),
      lon: Number(cached.lon),
    };
  } catch {
    return null;
  }
}

export function writeWeatherCache(lat, lon, weather, storage, at = Date.now()) {
  const backend = safeStorage(storage);
  if (!backend) return;
  try {
    backend.setItem(WEATHER_CACHE_KEY, JSON.stringify({ lat, lon, at, weather: { ...weather } }));
  } catch {
    // A full or disabled localStorage must never break the clock.
  }
}

/**
 * Return cached weather when fresh, fetch when stale, and fall back to the
 * last reading for the same coordinates when the network is unavailable.
 */
export async function fetchWeatherCached(lat, lon, options = {}) {
  const { storage, force = false, maxAgeMs = WEATHER_CACHE_TTL, nowMs = Date.now } = options;
  const cached = readWeatherCache(storage);
  const samePlace =
    cached &&
    Number.isFinite(cached.lat) &&
    Number.isFinite(cached.lon) &&
    Math.abs(cached.lat - lat) < 0.02 &&
    Math.abs(cached.lon - lon) < 0.02;

  if (samePlace && !force && nowMs() - cached.at < maxAgeMs) {
    return { ...cached.weather, cached: true, fetchedAt: cached.at };
  }

  try {
    const weather = await fetchWeather(lat, lon, options);
    const at = nowMs();
    writeWeatherCache(lat, lon, weather, storage, at);
    return { ...weather, cached: false, fetchedAt: at };
  } catch (error) {
    if (samePlace) {
      return {
        ...cached.weather,
        cached: true,
        stale: true,
        fetchedAt: cached.at,
        error: error?.message || 'weather unavailable',
      };
    }
    throw error;
  }
}
