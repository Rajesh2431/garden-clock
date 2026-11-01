import { THEMES, THEME_KEYS, applyTheme, getTheme, themeForState } from './themes.js';
import { parts, now, syncInfo, syncTime, wallDate, SYNC_INTERVAL_MS } from './clock.js';
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
import { Garden, MAX_EXTRA_GROWTH } from './garden.js';
import { FX } from './fx.js';
import { Sky } from './sky.js';
import {
  PHASES,
  SEASON_KEYS,
  SEASONS,
  constellationForDate,
  moonInfo,
  resolveSeason,
  timePhase,
} from './almanac.js';
import { clamp, randomSeed } from './rand.js';
import { composeScene, downloadCanvas } from './export.js';
import { BURST_SIZE, FRAME_BUDGET, FrameGovernor, detectQuality, isTier } from './quality.js';
import { initMonitoring, track } from './monitor.js';
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

const GROWTH_INTERVAL_MS = 18_000;
const GROWTH_OFFLINE_MS = 20 * 60 * 1000;
const TIME_THEME_PHASES = new Set(['morning', 'afternoon', 'evening', 'night']);

const $ = (selector, root = document) => root.querySelector(selector);

const KEYS = {
  theme: 'garden-clock:theme',
  season: 'garden-clock:season',
  h12: 'garden-clock:h12',
  secs: 'garden-clock:secs',
  loc: 'garden-clock:loc',
  growth: 'garden-clock:growth:v1',
  quality: 'garden-clock:quality:v1',
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

const readSeedParam = () => {
  const raw = params.get('seed');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value >>> 0 : null;
};

const savedLoc = store.get(KEYS.loc, null);
const initialLoc =
  savedLoc && Number.isFinite(savedLoc.lat) && Number.isFinite(savedLoc.lon) ? savedLoc : null;
const regrowOnLoad = params.get('regrow') === '1';
const urlSeed = regrowOnLoad ? null : readSeedParam();
const qualityParam = params.get('quality');
const qualityLocked = isTier(qualityParam);
const initialQuality = detectQuality({
  cores: navigator.hardwareConcurrency,
  memory: navigator.deviceMemory,
  coarse: window.matchMedia?.('(pointer: coarse)').matches,
  saveData: navigator.connection?.saveData,
  override: qualityParam,
  remembered: qualityLocked ? null : store.get(KEYS.quality, null),
});

const els = {
  stage: $('#stage'),
  sky: $('#sky'),
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
  skyNote: $('#sky-note'),
  stale: $('#w-stale'),
  simBadge: $('#sim-badge'),
  retry: $('#w-retry'),
  city: $('#city'),
  cityList: $('#city-list'),
  cityForm: $('#city-form'),
  locate: $('#locate'),
  theme: $('#theme'),
  season: $('#season'),
  sim: $('#sim'),
  h12: $('#h12'),
  secs: $('#secs'),
  bloom: $('#bloom'),
  share: $('#share'),
  save: $('#save'),
  fullscreen: $('#fullscreen'),
  sync: $('#sync'),
  toast: $('#toast'),
  debug: $('#debug'),
};

const state = {
  theme: store.get(KEYS.theme, 'auto'),
  seasonPref: store.get(KEYS.season, 'auto'),
  h12: !!store.get(KEYS.h12, false),
  secs: store.get(KEYS.secs, true),
  loc: initialLoc,
  tz: initialLoc?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  kind: 'clear',
  isDay: true,
  wind: 0,
  code: 0,
  hasWeather: false,
  temp: null,
  sim: '',
  seed: urlSeed ?? randomSeed(),
  themeKey: null,
  current: getTheme('noir'),
  hour24: new Date().getHours(),
  minute24: new Date().getMinutes(),
  phase: timePhase(new Date().getHours(), new Date().getMinutes()),
  seasonKey: resolveSeason(
    'auto',
    wallDate(initialLoc?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone),
    initialLoc?.lat ?? 0,
  ),
  dateKey: '',
  moon: moonInfo(new Date()),
  constellation: constellationForDate(
    wallDate(initialLoc?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone),
  ),
  growth: 0,
  builtSeason: null,
  hiddenAt: 0,
  quality: initialQuality,
  reduced: reducedQuery.matches,
  lastSecond: -1,
  lastClockKey: '',
  lastMinuteKey: '',
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
if (state.seasonPref !== 'auto' && !SEASON_KEYS.includes(state.seasonPref)) state.seasonPref = 'auto';

const garden = new Garden(els.garden, {
  reducedMotion: state.reduced,
  quality: state.quality,
});
const fx = new FX(els.fx, {
  reducedMotion: state.reduced,
  quality: state.quality,
  seed: state.seed,
});
const sky = new Sky(els.sky, {
  reducedMotion: state.reduced,
  quality: state.quality,
});
const governor = new FrameGovernor({ tier: state.quality, locked: qualityLocked });

let rafId = 0;
let lastFrame = 0;
let lastRender = 0;
// Per-canvas redraw times; each layer has its own budget per quality tier.
const layerAt = { sky: 0, garden: 0, fx: 0 };
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
  updateSky();
}

function skyPhase() {
  // Selecting a time theme changes the whole scene, including the sky. Other
  // themes keep the real local phase so weather and daylight still agree.
  return TIME_THEME_PHASES.has(state.themeKey) ? state.themeKey : state.phase;
}

function updateSky() {
  if (!sky) return;
  const instant = now();
  sky.set({
    phase: skyPhase(),
    kind: effectiveKind(),
    theme: state.current,
    // Wall-clock date for the city's calendar day; real instant for the moon.
    date: wallDate(state.tz, instant),
    instant: new Date(instant),
    latitude: state.loc?.lat ?? 0,
    longitude: state.loc?.lon ?? 0,
    season: state.seasonKey,
  });
}

function updateSkyNote() {
  if (!els.skyNote) return;
  const moonPercent = Math.round(state.moon.illumination * 100);
  const labelPhase = skyPhase();
  els.skyNote.textContent = [
    PHASES[labelPhase]?.label || 'Sky',
    `${state.moon.name} ${moonPercent}%`,
    [state.constellation.name, state.constellation.special?.name].filter(Boolean).join(' · '),
    `${SEASONS[state.seasonKey]?.label || ''} garden`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function updateSeasonAndSky() {
  const instant = now();
  // Season and zodiac follow the selected city's calendar day, not UTC's.
  const localDate = wallDate(state.tz, instant);
  const season = resolveSeason(state.seasonPref, localDate, state.loc?.lat ?? 0);
  const phase = timePhase(state.hour24, state.minute24);
  const changed = season !== state.seasonKey || phase !== state.phase;
  state.seasonKey = season;
  state.phase = phase;
  state.moon = moonInfo(new Date(instant));
  state.constellation = constellationForDate(localDate);
  document.body.dataset.season = season;
  document.body.dataset.phase = phase;
  updateSkyNote();
  updateSky();
  return changed;
}

function restoreGrowth() {
  const stored = store.get(KEYS.growth, null);
  if (stored && stored.seed === state.seed) {
    state.growth = clamp(Math.floor(Number(stored.count) || 0), 0, MAX_EXTRA_GROWTH);
    const elapsed = Math.max(0, Date.now() - (Number(stored.at) || Date.now()));
    state.growth = Math.min(
      MAX_EXTRA_GROWTH,
      state.growth + Math.min(4, Math.floor(elapsed / GROWTH_OFFLINE_MS)),
    );
  } else {
    state.growth = 0;
  }
}

function persistGrowth() {
  store.set(KEYS.growth, { seed: state.seed, count: state.growth, at: Date.now() });
}

function growGarden() {
  if (state.growth >= MAX_EXTRA_GROWTH) return;
  const before = garden.extraGrowth;
  const vine = garden.growOne();
  if (!vine || garden.extraGrowth === before) return;
  state.growth = garden.extraGrowth;
  persistGrowth();
  track('garden_grow', { seed: state.seed, growth: state.growth });
  if (state.debug) updateDebug();
}

function refreshTheme({ rebuild = true, resetFx = true } = {}) {
  const key = resolveThemeKey();
  const changed = key !== state.themeKey;
  const seasonChanged = state.builtSeason !== state.seasonKey;
  state.themeKey = key;
  state.current = getTheme(key);
  applyTheme(state.current, key);
  if (resetFx) applyWeatherFX();
  updateSkyNote();
  if (rebuild && (changed || seasonChanged)) rebuildGarden();
  return changed || seasonChanged;
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

function rebuildGarden() {
  garden.build(boxOfClock(), state.seed, state.current, {
    season: state.seasonKey,
    growth: state.growth,
  });
  state.builtSeason = state.seasonKey;
  garden.setWind(state.wind);
  if (state.debug) updateDebug();
  track('garden_build', {
    seed: state.seed,
    theme: state.themeKey,
    kind: effectiveKind(),
    season: state.seasonKey,
    growth: state.growth,
  });
}

// The Bloom button keeps the garden and opens a burst of flowers along its
// vines, with one butterfly coming to visit.
function bloomMore() {
  const flowers = garden.bloomBurst({ count: BURST_SIZE[state.quality], season: state.seasonKey });
  if (!flowers.length) return;
  toast(flowers.length === 1 ? 'A flower is blooming' : `${flowers.length} flowers are blooming`);
  track('bloom_burst', { count: flowers.length, season: state.seasonKey, quality: state.quality });
  if (state.debug) updateDebug();
}

// Move every canvas to a new quality tier. A rebuild with the same seed keeps
// the garden, its age and the clicked blooms; only the pixel ratio and the
// particle budgets change.
function applyQuality(tier, { remember = false } = {}) {
  if (!isTier(tier) || tier === state.quality) return;
  state.quality = tier;
  garden.setQuality(tier);
  fx.setQuality(tier);
  sky.setQuality(tier);
  if (remember) store.set(KEYS.quality, { tier, at: Date.now() });
  initLayout();
  track('quality', { tier, fps: Math.round(governor.fps) });
  if (state.debug) updateDebug();
}

function initLayout() {
  garden.resize();
  fx.resize();
  sky.resize();
  garden.setReduced(state.reduced);
  fx.setReduced(state.reduced);
  sky.setReduced(state.reduced);
  updateSeasonAndSky();
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

  const localNow = parts(state.tz, false);
  state.hour24 = localNow.hour24;
  state.minute24 = Number(localNow.mm) || 0;
  updateSeasonAndSky();
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
      if (state.loc.timezone) state.tz = state.loc.timezone;
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
  state.lastClockKey = key;
  state.hour24 = p.hour24;
  state.minute24 = Number(p.mm) || 0;

  els.hh.textContent = p.hh;
  els.mm.textContent = p.mm;
  els.ss.textContent = p.ss;
  els.meridiem.textContent = p.meridiem;
  els.date.textContent = p.date;
  els.tz.textContent = p.tzName;
  els.time.setAttribute('aria-label', `${p.hh}:${p.mm}:${p.ss} ${p.meridiem} ${p.tzName}`.trim());
  els.weather.setAttribute('aria-label', `Local weather in ${placeName(state.loc)}`);

  if (`${p.hh}:${p.mm}` !== state.lastTitle) {
    state.lastTitle = `${p.hh}:${p.mm}`;
    document.title = `${p.hh}:${p.mm} · Garden Clock`;
  }

  // Season, sky and theme change at most once a minute; skip them on the other
  // 59 ticks. A forced update (location, toggles, wake) always refreshes.
  const minuteKey = `${p.hour24}:${p.mm}:${p.date}:${p.timeZone}`;
  if (!force && minuteKey === state.lastMinuteKey) return;
  state.lastMinuteKey = minuteKey;

  updateSeasonAndSky();
  if (state.theme === 'auto') {
    const keyNow = resolveThemeKey();
    if (keyNow !== state.themeKey || state.builtSeason !== state.seasonKey) refreshTheme();
  } else if (state.builtSeason !== state.seasonKey) {
    // A manual theme still follows the calendar; midnight can change the season.
    rebuildGarden();
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
  auto.textContent = 'Auto (time + weather)';
  els.theme.append(auto);
  for (const key of THEME_KEYS) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = THEMES[key].name;
    els.theme.append(option);
  }
  els.theme.value = state.theme;
}

function buildSeasonOptions() {
  els.season.replaceChildren();
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = 'Auto season';
  els.season.append(auto);
  for (const key of SEASON_KEYS) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = SEASONS[key].label;
    els.season.append(option);
  }
  els.season.value = state.seasonPref;
}

function attachUI() {
  els.h12.checked = state.h12;
  els.secs.checked = state.secs;
  els.sim.value = state.sim;
  els.season.value = state.seasonPref;
  setToggleClasses();

  els.theme.addEventListener('change', () => {
    state.theme = els.theme.value;
    store.set(KEYS.theme, state.theme);
    refreshTheme();
    track('theme_choice', { theme: state.theme });
  });

  els.season.addEventListener('change', () => {
    state.seasonPref = els.season.value;
    store.set(KEYS.season, state.seasonPref);
    updateSeasonAndSky();
    refreshTheme();
    track('season_choice', { season: state.seasonPref });
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

  els.bloom.addEventListener('click', bloomMore);

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
    if (event.target.closest('aside, button, input, select, a, label, nav')) return;
    const rect = els.stage.getBoundingClientRect();
    const flower = garden.bloomAt(event.clientX - rect.left, event.clientY - rect.top, {
      season: state.seasonKey,
    });
    if (flower) {
      track('bloom_click', {
        species: flower.species,
        season: state.seasonKey,
        phase: state.phase,
      });
      if (state.debug) updateDebug();
    }
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

async function saveGarden() {
  try {
    const canvas = composeScene({
      stage: els.stage,
      timeEl: els.time,
      layers: [els.sky, els.garden, els.fx],
      theme: state.current,
      clock: parts(state.tz, state.h12),
      showSeconds: state.secs,
      weather: state.hasWeather
        ? { temp: state.temp, text: `${label(state.code)} · ${placeName(state.loc)}` }
        : null,
    });
    if (!canvas) return;
    const saved = await downloadCanvas(canvas, `garden-clock-${state.seed}.png`);
    if (!saved) {
      toast('Could not save this garden');
      return;
    }
    toast('Garden saved');
    track('save_png', { seed: state.seed, theme: state.themeKey });
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
  els.fullscreen.title = document.fullscreenElement ? 'Exit full screen (F)' : 'Toggle full screen (F)';
}

// Letter shortcuts should still work after clicking a button or checkbox; only
// fields where letters mean something (text entry, select type-ahead) opt out.
function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type);
}

function handleKeydown(event) {
  if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
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
  } else if (key === 'b' || key === 'r') {
    event.preventDefault();
    bloomMore();
  } else if (event.key === 'Escape' && els.controls.classList.contains('hidden')) {
    els.controls.classList.remove('hidden');
  }
}

function handleMotionPreference(event) {
  state.reduced = event.matches;
  garden.setReduced(state.reduced);
  fx.setReduced(state.reduced);
  sky.setReduced(state.reduced);
  applyWeatherFX();
  if (!state.reduced) rebuildGarden();
}

function catchUpGrowth(hiddenFor) {
  if (hiddenFor < GROWTH_OFFLINE_MS || state.growth >= MAX_EXTRA_GROWTH) return false;
  const steps = Math.min(4, Math.floor(hiddenFor / GROWTH_OFFLINE_MS));
  if (!steps) return false;
  state.growth = Math.min(MAX_EXTRA_GROWTH, state.growth + steps);
  persistGrowth();
  rebuildGarden();
  return true;
}

function handleVisibility() {
  if (document.hidden) {
    state.hiddenAt = Date.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    releaseWakeLock();
    return;
  }
  const hiddenFor = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
  state.hiddenAt = 0;
  catchUpGrowth(hiddenFor);
  lastFrame = performance.now();
  lastRender = 0;
  governor.reset();
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
    `${effectiveKind()} ${state.isDay ? 'day' : 'night'} · ${state.phase} · wind ${Math.round(state.wind)} km/h`,
    `${SEASONS[state.seasonKey]?.label || state.seasonKey} · ${state.moon.name} · growth ${state.growth}/${MAX_EXTRA_GROWTH}`,
    `blooms ${garden.extras.length} · visitors ${garden.butterflies.length}`,
    `${fps} fps drawn · ${Math.round(governor.fps) || '–'} fps rAF · ${state.quality}${qualityLocked ? ' (locked)' : ''}`,
    `build ${garden.buildMs.toFixed(1)} ms · dpr ${garden.dpr}`,
    `offset ${Math.round(info.offset)} ms · ${info.source || 'local'}`,
  ].join('\n');
}

function due(layer, budget, timestamp) {
  if (budget && timestamp - layerAt[layer] < budget) return false;
  layerAt[layer] = timestamp;
  return true;
}

function frame(timestamp) {
  rafId = requestAnimationFrame(frame);
  updateClock();

  const slower = governor.sample(timestamp);
  if (slower) applyQuality(slower, { remember: true });

  const slow = ['cloud', 'fog'].includes(effectiveKind());
  const interval = state.reduced ? 1000 / 12 : slow ? 1000 / 30 : 0;
  if (interval && timestamp - lastRender < interval) return;
  lastRender = timestamp;

  const budget = FRAME_BUDGET[state.quality] || FRAME_BUDGET.high;
  if (due('sky', budget.sky, timestamp)) sky.draw(timestamp);
  if (due('garden', budget.garden, timestamp)) garden.draw(state.current, timestamp);
  if (due('fx', budget.fx, timestamp)) {
    const dt = lastFrame ? Math.min(0.08, (timestamp - lastFrame) / 1000) : 1 / 60;
    lastFrame = timestamp;
    fx.draw(dt, timestamp, state.current);
  }

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
    layerAt.sky = 0;
    layerAt.garden = 0;
    layerAt.fx = 0;
    fpsAt = performance.now();
    fpsFrames = 0;
    rafId = requestAnimationFrame(frame);
  }
}

function initAnalytics() {
  if (!__VERCEL__) return;
  try {
    inject();
    injectSpeedInsights();
  } catch (error) {
    console.warn('[GardenClock] Vercel analytics unavailable:', error?.message || error);
  }
}

function init() {
  initAnalytics();
  initMonitoring();
  buildThemeOptions();
  buildSeasonOptions();
  attachUI();
  if (regrowOnLoad) {
    // state.seed is already fresh; record it before the first (only) build.
    state.growth = 0;
    setSeedParam();
    persistGrowth();
  } else {
    restoreGrowth();
  }
  refreshTheme({ rebuild: false, resetFx: false });
  initLayout();
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
  window.setInterval(() => {
    if (!document.hidden) growGarden();
  }, GROWTH_INTERVAL_MS);
  track('app_open', { theme: state.theme });
}

init();
