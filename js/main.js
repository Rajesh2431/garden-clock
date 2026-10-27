import { THEMES, THEME_KEYS, applyTheme, getTheme, themeForState } from './themes.js';
import { parts, now, syncInfo, syncTime, SYNC_INTERVAL_MS } from './clock.js';
import {
  DEFAULT_LOCATION,
  KIND_LABELS,
  WEATHER_CACHE_TTL,
  fetchWeatherCached,
  geocode,
  kindOf,
  label,
  locate,
  searchCities,
} from './weather.js';
import { Garden } from './garden.js';
import { FX } from './fx.js';
import { randomSeed } from './rand.js';
import { initMonitoring, track } from './monitor.js';

const $ = (selector, root = document) => root.querySelector(selector);

const KEYS = {
  theme: 'garden-clock:theme',
  h12: 'garden-clock:h12',
  secs: 'garden-clock:secs',
  loc: 'garden-clock:loc',
};

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private browsing can disable storage; the clock still works.
    }
  },
};

const params = new URLSearchParams(location.search);
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const readSeedParam = () => {
  const raw = params.get('seed');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value >>> 0 : null;
};

const savedLoc = store.get(KEYS.loc, null);
const initialLoc =
  savedLoc && Number.isFinite(savedLoc.lat) && Number.isFinite(savedLoc.lon) ? savedLoc : null;
const urlSeed = readSeedParam();
const lowPower = !!(
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
  (navigator.deviceMemory && navigator.deviceMemory <= 4)
);

const els = {
  stage: $('#stage'),
  garden: $('#garden'),
  fx: $('#fx'),
  controls: $('#controls'),
  clock: $('#clock'),
  time: $('#time'),
  clockMeta: $('#clock-meta'),
  hh: $('#hh'),
  mm: $('#mm'),
  ss: $('#ss'),
  meridiem: $('#meridiem'),
  date: $('#date'),
  tz: $('#tz'),
  weather: $('#weather'),
  temp: $('#w-temp'),
  desc: $('#w-desc'),
  meta: $('#w-meta'),
  stale: $('#w-stale'),
  simBadge: $('#sim-badge'),
  retry: $('#w-retry'),
  city: $('#city'),
  cityList: $('#city-list'),
  cityForm: $('#city-form'),
  locate: $('#locate'),
  theme: $('#theme'),
  sim: $('#sim'),
  h12: $('#h12'),
  secs: $('#secs'),
  regrow: $('#regrow'),
  share: $('#share'),
  save: $('#save'),
  fullscreen: $('#fullscreen'),
  sync: $('#sync'),
  toast: $('#toast'),
  debug: $('#debug'),
};

const state = {
  theme: store.get(KEYS.theme, 'auto'),
  h12: !!store.get(KEYS.h12, false),
  secs: store.get(KEYS.secs, true),
  loc: initialLoc,
  tz:
    initialLoc?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC',
  kind: 'clear',
  isDay: true,
  wind: 0,
  code: 0,
  hasWeather: false,
  sim: '',
  seed: urlSeed ?? randomSeed(),
  fixedSeed: urlSeed !== null,
  themeKey: null,
  current: getTheme('noir'),
  hour24: new Date().getHours(),
  lowPower,
  reduced: reducedQuery.matches,
  lastSecond: -1,
  lastClockKey: '',
  lastTitle: '',
  weatherBusy: false,
  syncBusy: false,
  lastWeatherAt: 0,
  suggestionTimer: 0,
  suggestionController: null,
  suggestions: [],
  debug: params.get('debug') === '1',
  kiosk: params.get('kiosk') === '1',
};
if (state.theme !== 'auto' && !THEMES[state.theme]) state.theme = 'auto';

const garden = new Garden(els.garden, {
  reducedMotion: state.reduced,
  lowPower: state.lowPower,
});
const fx = new FX(els.fx, {
  reducedMotion: state.reduced,
  lowPower: state.lowPower,
  seed: state.seed,
});

let rafId = 0;
let lastFrame = 0;
let lastRender = 0;
let toastTimer = 0;
let resizeTimer = 0;
let fpsFrames = 0;
let fpsAt = 0;
let fps = 0;
let wakeLock = null;

async function keepAwake() {
  if (!navigator.wakeLock || document.hidden) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (document.hidden) {
      await lock.release();
      return;
    }
    wakeLock = lock;
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    // Wake lock is a nice-to-have for desk displays and may be denied.
  }
}

function releaseWakeLock() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function prefersDark() {
  return darkQuery.matches;
}

function effectiveKind() {
  return state.sim || state.kind;
}

function resolveThemeKey() {
  return themeForState({
    theme: state.theme,
    kind: effectiveKind(),
    isDay: state.isDay,
    hour: state.hour24,
    hasWeather: state.hasWeather,
    prefersDark: prefersDark(),
  });
}

function toast(message, timeout = 2300) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), timeout);
}

function setSync(stateName, text, title = '') {
  if (!els.sync) return;
  els.sync.dataset.state = stateName;
  els.sync.textContent = text;
  els.sync.title = title;
}

function updateSimBadge() {
  if (!els.simBadge) return;
  if (!state.sim) {
    els.simBadge.hidden = true;
    els.simBadge.textContent = '';
    return;
  }
  els.simBadge.hidden = false;
  els.simBadge.textContent = `Simulating ${KIND_LABELS[state.sim] || state.sim}`;
}

function applyWeatherFX() {
  fx.set(effectiveKind(), state.isDay, state.wind, state.current);
  garden.setWind(state.wind);
  updateSimBadge();
}

function refreshTheme({ rebuild = true, resetFx = true } = {}) {
  const key = resolveThemeKey();
  const changed = key !== state.themeKey;
  state.themeKey = key;
  state.current = getTheme(key);
  applyTheme(state.current, key);
  if (resetFx) applyWeatherFX();
  if (changed && rebuild) rebuildGarden();
  return changed;
}

function boxOfClock() {
  const stageRect = els.stage.getBoundingClientRect();
  const timeRect = els.time.getBoundingClientRect();
  const metaRect = els.clockMeta.getBoundingClientRect();
  // Leave enough room for the largest bloom as well as the digits and date line.
  const pad = Math.max(16, Math.min(stageRect.width, stageRect.height) * 0.04);
  const left = Math.min(timeRect.left, metaRect.left);
  const right = Math.max(timeRect.right, metaRect.right);
  const top = timeRect.top;
  const bottom = Math.max(timeRect.bottom, metaRect.bottom);
  return {
    x: left - stageRect.left - pad,
    y: top - stageRect.top - pad,
    w: right - left + pad * 2,
    h: bottom - top + pad * 2,
  };
}

function setSeedParam() {
  const url = new URL(location.href);
  url.searchParams.set('seed', String(state.seed));
  url.searchParams.delete('regrow');
  history.replaceState(null, '', url);
}

function rebuildGarden({ freshSeed = false, announce = false } = {}) {
  if (freshSeed) {
    state.seed = randomSeed();
    state.fixedSeed = false;
    setSeedParam();
  }
  garden.build(boxOfClock(), state.seed, state.current);
  garden.setWind(state.wind);
  if (announce) toast('A new garden is growing');
  if (state.debug) updateDebug();
  track('garden_build', { seed: state.seed, theme: state.themeKey, kind: effectiveKind() });
}

function regrow(options = {}) {
  rebuildGarden({ freshSeed: true, announce: true, ...options });
}

function initLayout() {
  garden.resize();
  fx.resize();
  garden.setReduced(state.reduced);
  fx.setReduced(state.reduced);
  rebuildGarden();
  applyWeatherFX();
  updateClock(true);
}

function updateWeatherUI(weather, loc) {
  state.temp = weather.temp;
  state.code = weather.code;
  state.kind = kindOf(weather.code);
  state.isDay = !!weather.isDay;
  state.wind = Number(weather.wind) || 0;
  state.hasWeather = true;
  state.lastWeatherAt = Date.now();
  if (weather.tz) {
    state.tz = weather.tz;
    state.loc = { ...loc, timezone: weather.tz };
    store.set(KEYS.loc, state.loc);
  } else {
    state.loc = loc;
    store.set(KEYS.loc, loc);
  }

  const place = placeName(loc);
  els.temp.textContent = `${weather.temp}°C`;
  els.desc.textContent = `${label(weather.code)} · ${place}`;
  const meta = [];
  if (Number.isFinite(weather.humidity)) meta.push(`Humidity ${weather.humidity}%`);
  if (Number.isFinite(weather.wind)) meta.push(`Wind ${weather.wind} km/h`);
  const sunrise = extractTime(weather.sunrise);
  const sunset = extractTime(weather.sunset);
  if (sunrise && sunset) meta.push(`Sunrise ${sunrise} · Sunset ${sunset}`);
  els.meta.textContent = meta.join(' · ');
  els.weather.title = `${label(weather.code)} · ${loc.label || loc.name || ''}`;

  if (weather.stale) {
    els.stale.hidden = false;
    els.stale.textContent = `Offline · updated ${formatCachedTime(weather.fetchedAt)}`;
  } else {
    els.stale.hidden = true;
    els.stale.textContent = '';
  }
  els.retry.hidden = !weather.stale;
  if (document.activeElement !== els.city) els.city.value = place;

  state.hour24 = parts(state.tz, false).hour24;
  refreshTheme();
  updateClock(true);
  track('weather', {
    kind: state.kind,
    cached: !!weather.cached,
    stale: !!weather.stale,
  });
}

function placeName(loc) {
  const value = loc?.name || loc?.label || 'Your location';
  return value.split(',')[0].trim() || 'Your location';
}

function extractTime(value) {
  if (!value) return '';
  const match = String(value).match(/T(\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function formatCachedTime(timestamp) {
  if (!timestamp) return 'earlier';
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(timestamp),
    );
  } catch {
    return 'earlier';
  }
}

function setWeatherLoading() {
  els.temp.textContent = '--°';
  els.desc.textContent = state.loc ? 'Reading the sky…' : 'Locating your garden…';
  els.meta.textContent = '';
  els.stale.hidden = true;
  els.retry.hidden = true;
}

function weatherFailure(error) {
  console.warn('[GardenClock] Weather unavailable:', error?.message || error);
  if (state.hasWeather) {
    els.retry.hidden = false;
    toast('Weather refresh failed');
    return;
  }
  els.temp.textContent = '--°';
  els.desc.textContent = 'Weather unavailable';
  els.meta.textContent = 'The clock is still running on local time.';
  els.stale.hidden = true;
  els.retry.hidden = false;
  refreshTheme();
}

async function loadWeather({ force = false } = {}) {
  if (state.weatherBusy) return;
  state.weatherBusy = true;
  if (!state.hasWeather) setWeatherLoading();
  try {
    if (!state.loc) {
      const located = await locate();
      state.loc = located || { ...DEFAULT_LOCATION };
      store.set(KEYS.loc, state.loc);
      if (state.loc.timezone && !state.tz) state.tz = state.loc.timezone;
      updateClock(true);
    }
    const weather = await fetchWeatherCached(state.loc.lat, state.loc.lon, { force });
    updateWeatherUI(weather, state.loc);
  } catch (error) {
    weatherFailure(error);
  } finally {
    state.weatherBusy = false;
  }
}

async function syncClock({ manual = false } = {}) {
  if (state.syncBusy) return;
  if (navigator.onLine === false) {
    setSync('offline', 'Offline · local clock', 'No network; keeping the last known offset.');
    if (manual) toast('You are offline; using the local clock');
    return;
  }
  state.syncBusy = true;
  setSync('syncing', 'Syncing clock…');
  try {
    const result = await syncTime();
    const info = syncInfo();
    if (result.ok) {
      const stamp = info.lastSync
        ? info.lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      setSync(
        'ok',
        `Synced ${stamp}`,
        `${info.source} · offset ${Math.round(info.offset)} ms · RTT ${Math.round(info.rtt)} ms`,
      );
      if (manual) toast('Clock synced');
    } else {
      setSync('local', 'Local clock', info.error || 'Internet time was unavailable.');
      if (manual) toast('Using the local clock');
    }
    updateClock(true);
  } finally {
    state.syncBusy = false;
  }
}

function updateClock(force = false) {
  const second = Math.floor(now() / 1000);
  if (!force && second === state.lastSecond) return;
  state.lastSecond = second;
  const p = parts(state.tz, state.h12);
  const key = `${p.hh}:${p.mm}:${p.ss}:${p.meridiem}:${p.date}:${p.tzName}:${state.secs}`;
  const hourChanged = state.hour24 !== p.hour24;
  const wasInitialised = state.lastClockKey !== '';
  state.lastClockKey = key;
  state.hour24 = p.hour24;

  els.hh.textContent = p.hh;
  els.mm.textContent = p.mm;
  els.ss.textContent = p.ss;
  els.meridiem.textContent = p.meridiem;
  els.date.textContent = p.date;
  els.tz.textContent = p.tzName;
  els.time.setAttribute('aria-label', `${p.hh}:${p.mm}:${p.ss} ${p.meridiem} ${p.tzName}`.trim());
  els.weather.setAttribute('aria-label', `Local weather in ${placeName(state.loc)}`);

  if (p.mm !== state.lastTitle) {
    state.lastTitle = p.mm;
    document.title = `${p.hh}:${p.mm} · Garden Clock`;
  }

  if (hourChanged && wasInitialised) {
    const keyNow = resolveThemeKey();
    if (state.theme === 'auto' && keyNow !== state.themeKey) {
      refreshTheme();
    } else if (state.fixedSeed) {
      rebuildGarden();
    } else {
      regrow({ announce: false });
    }
  }
}

function setToggleClasses() {
  document.body.classList.toggle('no-seconds', !state.secs);
  document.body.classList.toggle('no-meridiem', !state.h12);
}

function buildThemeOptions() {
  els.theme.replaceChildren();
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = 'Auto (weather)';
  els.theme.append(auto);
  for (const key of THEME_KEYS) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = THEMES[key].name;
    els.theme.append(option);
  }
  els.theme.value = state.theme;
}

function attachUI() {
  els.h12.checked = state.h12;
  els.secs.checked = state.secs;
  els.sim.value = state.sim;
  setToggleClasses();

  els.theme.addEventListener('change', () => {
    state.theme = els.theme.value;
    store.set(KEYS.theme, state.theme);
    refreshTheme();
    track('theme_choice', { theme: state.theme });
  });

  els.sim.addEventListener('change', () => {
    state.sim = els.sim.value;
    refreshTheme();
    track('weather_simulation', { kind: state.sim || 'live' });
  });

  els.h12.addEventListener('change', () => {
    state.h12 = els.h12.checked;
    store.set(KEYS.h12, state.h12);
    setToggleClasses();
    updateClock(true);
    scheduleRebuild();
  });

  els.secs.addEventListener('change', () => {
    state.secs = els.secs.checked;
    store.set(KEYS.secs, state.secs);
    setToggleClasses();
    updateClock(true);
    scheduleRebuild();
  });

  els.regrow.addEventListener('click', () => {
    regrow();
    track('regrow', { seed: state.seed });
  });

  els.share.addEventListener('click', shareGarden);
  els.save.addEventListener('click', saveGarden);
  els.fullscreen.addEventListener('click', toggleFullscreen);
  els.retry.addEventListener('click', () => loadWeather({ force: true }));
  els.locate.addEventListener('click', useMyLocation);

  els.cityForm.addEventListener('submit', submitCity);
  els.city.addEventListener('input', scheduleCitySearch);
  els.city.addEventListener('focus', () => {
    if (els.city.value && !state.suggestions.length) scheduleCitySearch();
  });

  els.stage.addEventListener('click', (event) => {
    if (event.target.closest('aside, button, input, select, a, label')) return;
    regrow();
    track('regrow', { seed: state.seed, source: 'stage' });
  });

  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('fullscreenchange', updateFullscreenState);
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('online', () => {
    syncClock();
    loadWeather({ force: true });
  });
  window.addEventListener('offline', () => {
    setSync('offline', 'Offline · local clock');
  });

  reducedQuery.addEventListener('change', handleMotionPreference);
  darkQuery.addEventListener('change', () => {
    if (state.theme === 'auto' && !state.hasWeather) refreshTheme();
  });

  if (window.ResizeObserver) {
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(initLayout, 150);
    });
    observer.observe(els.stage);
  } else {
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(initLayout, 150);
    });
  }

  if (state.kiosk) els.controls.classList.add('hidden');
  els.fullscreen.setAttribute('aria-pressed', 'false');
}

function scheduleRebuild() {
  window.setTimeout(() => {
    if (document.hidden) return;
    rebuildGarden();
  }, 50);
}

async function submitCity(event) {
  event.preventDefault();
  const query = els.city.value.trim();
  if (!query) return;
  clearTimeout(state.suggestionTimer);
  state.suggestionController?.abort();
  try {
    const picked = state.suggestions.find(
      (item) => item.label === query || item.name === query || `${item.name}` === query,
    );
    const location = picked || (await geocode(query));
    if (!location) {
      toast(`No place found for “${query}”`);
      return;
    }
    state.loc = { ...location };
    state.tz = location.timezone || state.tz;
    store.set(KEYS.loc, state.loc);
    els.city.value = location.name || query;
    els.cityList.replaceChildren();
    state.suggestions = [];
    updateClock(true);
    await loadWeather({ force: true });
    toast(`Weather for ${location.name || 'your city'}`);
  } catch (error) {
    if (error?.name !== 'AbortError') toast('City search unavailable');
  }
}

function scheduleCitySearch() {
  clearTimeout(state.suggestionTimer);
  const query = els.city.value.trim();
  if (query.length < 2) {
    state.suggestions = [];
    els.cityList.replaceChildren();
    return;
  }
  state.suggestionTimer = window.setTimeout(async () => {
    state.suggestionController?.abort();
    const controller = new AbortController();
    state.suggestionController = controller;
    try {
      const results = await searchCities(query, { signal: controller.signal });
      state.suggestions = results;
      els.cityList.replaceChildren(
        ...results.map((item) => {
          const option = document.createElement('option');
          option.value = item.label;
          return option;
        }),
      );
    } catch (error) {
      if (error?.name !== 'AbortError') state.suggestions = [];
    }
  }, 300);
}

async function useMyLocation() {
  els.locate.disabled = true;
  try {
    const location = await locate();
    if (!location) {
      toast('Location is not available');
      return;
    }
    state.loc = location;
    state.tz = location.timezone || state.tz;
    store.set(KEYS.loc, state.loc);
    updateClock(true);
    await loadWeather({ force: true });
    toast('Using your location');
  } finally {
    els.locate.disabled = false;
  }
}

async function shareGarden() {
  setSeedParam();
  const url = location.href;
  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Garden Clock',
        text: 'A garden that keeps the time.',
        url,
      });
      toast('Garden shared');
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      toast('Garden link copied');
    } else {
      toast('Copy the address bar to share this garden');
    }
    track('share', { seed: state.seed });
  } catch (error) {
    if (error?.name !== 'AbortError') toast('Could not share this garden');
  }
}

function saveGarden() {
  try {
    const stageRect = els.stage.getBoundingClientRect();
    const width = Math.round(stageRect.width);
    const height = Math.round(stageRect.height);
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const theme = state.current;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, theme.bg2 || theme.bg);
    gradient.addColorStop(1, theme.bg);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(els.garden, 0, 0, width, height);
    ctx.drawImage(els.fx, 0, 0, width, height);

    const timeRect = els.time.getBoundingClientRect();
    const clockX = timeRect.left - stageRect.left + timeRect.width / 2;
    const clockY = timeRect.top - stageRect.top + timeRect.height * 0.55;
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    const fontSize =
      Number.parseFloat(getComputedStyle(els.time).fontSize) ||
      Math.min(width * 0.18, height * 0.3);
    const p = parts(state.tz, state.h12);
    ctx.fillStyle = theme.digit;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = `200 ${fontSize}px ${family}`;
    const main = `${p.hh}:${p.mm}`;
    const mainWidth = ctx.measureText(main).width;
    const seconds = state.secs ? p.ss : '';
    const smallSize = fontSize * 0.2;
    ctx.font = `200 ${smallSize}px ${family}`;
    const secondsWidth = seconds ? ctx.measureText(seconds).width : 0;
    const meridiemWidth = p.meridiem
      ? ctx.measureText(p.meridiem).width + smallSize * 0.4
      : 0;
    const gap = fontSize * 0.12;
    const total = mainWidth + (seconds ? gap + secondsWidth : 0) + meridiemWidth;
    let x = clockX - total / 2;
    ctx.font = `200 ${fontSize}px ${family}`;
    ctx.fillText(main, x, clockY);
    x += mainWidth + gap;
    ctx.font = `200 ${smallSize}px ${family}`;
    ctx.globalAlpha = 0.7;
    if (seconds) {
      ctx.fillText(seconds, x, clockY);
      x += secondsWidth + smallSize * 0.4;
    }
    if (p.meridiem) {
      ctx.fillText(p.meridiem, x, clockY);
    }
    ctx.globalAlpha = 1;

    const dateSize = Math.max(10, fontSize * 0.12);
    ctx.font = `300 ${dateSize}px ${family}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.digit;
    ctx.globalAlpha = 0.78;
    if (typeof ctx.letterSpacing === 'string') {
      ctx.letterSpacing = `${dateSize * 0.28}px`;
    }
    ctx.fillText(`${p.date.toUpperCase()} · ${p.tzName}`, clockX, clockY + dateSize * 2.6);
    ctx.globalAlpha = 1;

    if (state.hasWeather) {
      const wx = Math.max(22, width * 0.025);
      const wy = Math.max(22, height * 0.035);
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.digit;
      ctx.font = `200 ${Math.max(22, width * 0.034)}px ${family}`;
      ctx.fillText(`${state.temp}°C`, wx, wy + Math.max(22, width * 0.034));
      ctx.font = `300 ${Math.max(11, width * 0.012)}px ${family}`;
      ctx.globalAlpha = 0.82;
      ctx.fillText(
        `${label(state.code)} · ${placeName(state.loc)}`,
        wx,
        wy + Math.max(34, width * 0.048),
      );
      ctx.globalAlpha = 1;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        toast('Could not save this garden');
        return;
      }
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `garden-clock-${state.seed}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Garden saved');
      track('save_png', { seed: state.seed, theme: state.themeKey });
    }, 'image/png');
  } catch (error) {
    console.warn('[GardenClock] PNG export failed:', error);
    toast('Could not save this garden');
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast('Full screen is not available');
  }
}

function updateFullscreenState() {
  els.fullscreen.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  els.fullscreen.title = document.fullscreenElement
    ? 'Exit full screen (F)'
    : 'Toggle full screen (F)';
}

function handleKeydown(event) {
  const tag = event.target?.tagName;
  if (
    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag) ||
    event.target?.isContentEditable ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'f') {
    event.preventDefault();
    toggleFullscreen();
  } else if (key === 'h') {
    event.preventDefault();
    const hidden = els.controls.classList.toggle('hidden');
    toast(hidden ? 'Controls hidden · press H to show' : 'Controls shown');
  } else if (key === 'r') {
    event.preventDefault();
    regrow();
  } else if (event.key === 'Escape' && els.controls.classList.contains('hidden')) {
    els.controls.classList.remove('hidden');
  }
}

function handleMotionPreference(event) {
  state.reduced = event.matches;
  garden.setReduced(state.reduced);
  fx.setReduced(state.reduced);
  applyWeatherFX();
  if (!state.reduced) rebuildGarden();
}

function handleVisibility() {
  if (document.hidden) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    releaseWakeLock();
    return;
  }
  lastFrame = performance.now();
  lastRender = 0;
  updateClock(true);
  startLoop();
  keepAwake();
  const info = syncInfo();
  if (
    navigator.onLine !== false &&
    (!info.lastSync || Date.now() - info.lastSync.getTime() > SYNC_INTERVAL_MS)
  ) {
    syncClock();
  }
  if (!state.lastWeatherAt || Date.now() - state.lastWeatherAt > WEATHER_CACHE_TTL) {
    loadWeather({ force: true });
  }
}

function updateDebug() {
  if (!state.debug || !els.debug) return;
  const info = syncInfo();
  els.debug.hidden = false;
  els.debug.textContent = [
    `seed ${state.seed} · ${state.themeKey}`,
    `${effectiveKind()} ${state.isDay ? 'day' : 'night'} · wind ${Math.round(state.wind)} km/h`,
    `${fps} fps · build ${garden.buildMs.toFixed(1)} ms`,
    `offset ${Math.round(info.offset)} ms · ${info.source || 'local'}`,
  ].join('\n');
}

function frame(timestamp) {
  rafId = requestAnimationFrame(frame);
  updateClock();

  const slow = ['cloud', 'fog'].includes(effectiveKind());
  const interval = state.reduced ? 1000 / 12 : slow ? 1000 / 30 : 0;
  if (interval && timestamp - lastRender < interval) return;

  const dt = lastFrame ? Math.min(0.08, (timestamp - lastFrame) / 1000) : 1 / 60;
  lastFrame = timestamp;
  lastRender = timestamp;

  garden.draw(state.current, timestamp);
  fx.draw(dt, timestamp, state.current);

  fpsFrames += 1;
  if (timestamp - fpsAt > 500) {
    fps = Math.round((fpsFrames * 1000) / Math.max(1, timestamp - fpsAt));
    fpsFrames = 0;
    fpsAt = timestamp;
    if (state.debug) updateDebug();
  }
}

function startLoop() {
  if (!rafId) {
    lastFrame = performance.now();
    lastRender = 0;
    fpsAt = performance.now();
    fpsFrames = 0;
    rafId = requestAnimationFrame(frame);
  }
}

function init() {
  initMonitoring();
  buildThemeOptions();
  attachUI();
  refreshTheme({ rebuild: false, resetFx: false });
  initLayout();
  if (params.get('regrow') === '1') {
    state.seed = randomSeed();
    state.fixedSeed = false;
    setSeedParam();
    rebuildGarden();
  }
  syncClock();
  loadWeather();
  updateClock(true);
  startLoop();
  keepAwake();
  if (state.debug) {
    els.debug.hidden = false;
    updateDebug();
  }
  document.fonts?.ready?.then(() => {
    initLayout();
  });
  window.setInterval(() => {
    if (!document.hidden) syncClock();
  }, SYNC_INTERVAL_MS);
  window.setInterval(() => {
    if (!document.hidden && Date.now() - state.lastWeatherAt > WEATHER_CACHE_TTL) {
      loadWeather({ force: true });
    }
  }, 60_000);
  track('app_open', { theme: state.theme });
}

init();
