// Astronomical and seasonal helpers that do not depend on the browser. The sky
// renderer, theme picker and garden all use these functions so their labels and
// geometry agree.

const TAU = Math.PI * 2;
const DAY_MS = 86_400_000;
const SYNODIC_MONTH = 29.530588853;
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);

export const PHASES = {
  morning: { label: 'Morning', order: 0 },
  afternoon: { label: 'Afternoon', order: 1 },
  evening: { label: 'Evening', order: 2 },
  night: { label: 'Night', order: 3 },
};

export const PHASE_KEYS = Object.keys(PHASES);

export function timePhase(hour, minute = 0) {
  const h = Number.isFinite(Number(hour)) ? ((Number(hour) % 24) + 24) % 24 : 0;
  const m = Number.isFinite(Number(minute)) ? clampNumber(Number(minute), 0, 59) : 0;
  const minutes = h * 60 + m;
  if (minutes >= 5 * 60 && minutes < 12 * 60) return 'morning';
  if (minutes >= 12 * 60 && minutes < 17 * 60) return 'afternoon';
  if (minutes >= 17 * 60 && minutes < 21 * 60) return 'evening';
  return 'night';
}

export const SEASONS = {
  spring: {
    label: 'Spring',
    accent: '#ff9fbc',
    leaf: '#6fcf97',
    vine: '#6e9fdd',
    tint: 'rgba(255, 170, 198, 0.2)',
    flowers: ['tulip', 'daisy', 'cosmos', 'rose'],
  },
  summer: {
    label: 'Summer',
    accent: '#ffd166',
    leaf: '#4fae69',
    vine: '#4f8bda',
    tint: 'rgba(255, 208, 91, 0.18)',
    flowers: ['sunflower', 'lotus', 'rose', 'bell'],
  },
  autumn: {
    label: 'Autumn',
    accent: '#e8874f',
    leaf: '#c47a3a',
    vine: '#b46a4c',
    tint: 'rgba(232, 135, 79, 0.2)',
    flowers: ['chrysanthemum', 'cosmos', 'rose', 'bell'],
  },
  winter: {
    label: 'Winter',
    accent: '#a9d6ff',
    leaf: '#78a8c7',
    vine: '#7f9fd1',
    tint: 'rgba(160, 210, 255, 0.16)',
    flowers: ['camellia', 'rose', 'daisy', 'cosmos'],
  },
};

export const SEASON_KEYS = Object.keys(SEASONS);
const OPPOSITE = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' };

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function seasonForDate(date = new Date(), latitude = 0) {
  const month = (date instanceof Date ? date : new Date(date)).getUTCMonth();
  let season;
  if (month >= 2 && month <= 4) season = 'spring';
  else if (month >= 5 && month <= 7) season = 'summer';
  else if (month >= 8 && month <= 10) season = 'autumn';
  else season = 'winter';
  if (Number(latitude) < 0) season = OPPOSITE[season];
  return season;
}

export function resolveSeason(preference, date = new Date(), latitude = 0) {
  if (SEASONS[preference]) return preference;
  return seasonForDate(date, latitude);
}

export function seasonInfo(key) {
  return SEASONS[key] || SEASONS.spring;
}

export function dayOfYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / DAY_MS);
}

export function dateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function moonInfo(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const days = (d.getTime() - NEW_MOON_EPOCH) / DAY_MS;
  const age = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const phase = age / SYNODIC_MONTH;
  const illumination = (1 - Math.cos(phase * TAU)) / 2;
  const names = [
    'New moon',
    'Waxing crescent',
    'First quarter',
    'Waxing gibbous',
    'Full moon',
    'Waning gibbous',
    'Last quarter',
    'Waning crescent',
  ];
  const name = names[Math.round(phase * 8) % 8];
  return { age, phase, illumination, name };
}

// A compact zodiac catalogue. Coordinates are normalized to a 0..1 box so the
// sky renderer can place the same constellation on any screen.
export const CONSTELLATIONS = [
  {
    key: 'aries',
    name: 'Aries',
    stars: [
      { name: 'Hamal', x: 0.28, y: 0.32 },
      { name: 'Sheratan', x: 0.45, y: 0.48 },
      { name: 'Mesarthim', x: 0.56, y: 0.52 },
      { name: '41 Ari', x: 0.78, y: 0.3 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [0, 3],
    ],
  },
  {
    key: 'taurus',
    name: 'Taurus',
    stars: [
      { name: 'Aldebaran', x: 0.68, y: 0.52 },
      { name: 'Elnath', x: 0.78, y: 0.16 },
      { name: 'Alcyone', x: 0.4, y: 0.42 },
      { name: 'Tianguan', x: 0.18, y: 0.62 },
    ],
    lines: [
      [0, 2],
      [2, 3],
      [0, 1],
    ],
  },
  {
    key: 'gemini',
    name: 'Gemini',
    stars: [
      { name: 'Pollux', x: 0.7, y: 0.26 },
      { name: 'Castor', x: 0.56, y: 0.2 },
      { name: 'Alhena', x: 0.62, y: 0.68 },
      { name: 'Wasat', x: 0.54, y: 0.46 },
    ],
    lines: [
      [0, 1],
      [0, 3],
      [3, 2],
    ],
  },
  {
    key: 'cancer',
    name: 'Cancer',
    stars: [
      { name: 'Acubens', x: 0.22, y: 0.62 },
      { name: 'Tarf', x: 0.35, y: 0.3 },
      { name: 'Asellus Australis', x: 0.58, y: 0.56 },
      { name: 'Iota Cnc', x: 0.74, y: 0.4 },
    ],
    lines: [
      [0, 2],
      [1, 2],
      [2, 3],
    ],
  },
  {
    key: 'leo',
    name: 'Leo',
    stars: [
      { name: 'Regulus', x: 0.78, y: 0.66 },
      { name: 'Denebola', x: 0.2, y: 0.56 },
      { name: 'Algieba', x: 0.48, y: 0.36 },
      { name: 'Zosma', x: 0.34, y: 0.46 },
    ],
    lines: [
      [0, 2],
      [2, 1],
      [2, 3],
    ],
  },
  {
    key: 'virgo',
    name: 'Virgo',
    stars: [
      { name: 'Spica', x: 0.72, y: 0.68 },
      { name: 'Vindemiatrix', x: 0.52, y: 0.24 },
      { name: 'Porrima', x: 0.44, y: 0.42 },
      { name: 'Heze', x: 0.58, y: 0.48 },
    ],
    lines: [
      [0, 3],
      [3, 2],
      [2, 1],
    ],
  },
  {
    key: 'libra',
    name: 'Libra',
    stars: [
      { name: 'Zubeneschamali', x: 0.34, y: 0.3 },
      { name: 'Zubenelgenubi', x: 0.6, y: 0.46 },
      { name: 'Brachium', x: 0.78, y: 0.7 },
      { name: 'Sigma Lib', x: 0.52, y: 0.64 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [1, 3],
    ],
  },
  {
    key: 'scorpius',
    name: 'Scorpius',
    stars: [
      { name: 'Antares', x: 0.42, y: 0.4 },
      { name: 'Dschubba', x: 0.28, y: 0.26 },
      { name: 'Sargas', x: 0.56, y: 0.58 },
      { name: 'Shaula', x: 0.82, y: 0.76 },
    ],
    lines: [
      [1, 0],
      [0, 2],
      [2, 3],
    ],
  },
  {
    key: 'sagittarius',
    name: 'Sagittarius',
    stars: [
      { name: 'Kaus Australis', x: 0.3, y: 0.56 },
      { name: 'Nunki', x: 0.62, y: 0.42 },
      { name: 'Ascella', x: 0.5, y: 0.62 },
      { name: 'Albaldah', x: 0.74, y: 0.24 },
    ],
    lines: [
      [0, 2],
      [2, 1],
      [1, 3],
    ],
  },
  {
    key: 'capricornus',
    name: 'Capricornus',
    stars: [
      { name: 'Deneb Algedi', x: 0.22, y: 0.54 },
      { name: 'Dabih', x: 0.42, y: 0.3 },
      { name: 'Algedi', x: 0.62, y: 0.36 },
      { name: 'Nashira', x: 0.78, y: 0.58 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  },
  {
    key: 'aquarius',
    name: 'Aquarius',
    stars: [
      { name: 'Sadalsuud', x: 0.3, y: 0.28 },
      { name: 'Sadalmelik', x: 0.2, y: 0.48 },
      { name: 'Skat', x: 0.58, y: 0.62 },
      { name: 'Albali', x: 0.78, y: 0.4 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  },
  {
    key: 'pisces',
    name: 'Pisces',
    stars: [
      { name: 'Alpherg', x: 0.18, y: 0.4 },
      { name: 'Fumalsamakah', x: 0.38, y: 0.52 },
      { name: 'Alrescha', x: 0.62, y: 0.3 },
      { name: 'Torcular', x: 0.8, y: 0.56 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  },
];

const ZODIAC_RANGES = [
  { key: 'capricornus', from: [12, 22], to: [1, 19] },
  { key: 'aquarius', from: [1, 20], to: [2, 18] },
  { key: 'pisces', from: [2, 19], to: [3, 20] },
  { key: 'aries', from: [3, 21], to: [4, 19] },
  { key: 'taurus', from: [4, 20], to: [5, 20] },
  { key: 'gemini', from: [5, 21], to: [6, 20] },
  { key: 'cancer', from: [6, 21], to: [7, 22] },
  { key: 'leo', from: [7, 23], to: [8, 22] },
  { key: 'virgo', from: [8, 23], to: [9, 22] },
  { key: 'libra', from: [9, 23], to: [10, 22] },
  { key: 'scorpius', from: [10, 23], to: [11, 21] },
  { key: 'sagittarius', from: [11, 22], to: [12, 21] },
];

function inRange(month, day, [fromMonth, fromDay], [toMonth, toDay]) {
  const value = month * 100 + day;
  const start = fromMonth * 100 + fromDay;
  const end = toMonth * 100 + toDay;
  if (start <= end) return value >= start && value <= end;
  return value >= start || value <= end;
}

export function constellationForDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const range = ZODIAC_RANGES.find((entry) => inRange(month, day, entry.from, entry.to));
  const index = Math.max(
    0,
    CONSTELLATIONS.findIndex((item) => item.key === range?.key),
  );
  const base = CONSTELLATIONS[index] || CONSTELLATIONS[0];
  const specialIndex = (dayOfYear(d) - 1 + base.stars.length) % base.stars.length;
  return { ...base, special: base.stars[specialIndex], specialIndex };
}

export function starOfDay(date = new Date()) {
  return constellationForDate(date).special;
}

// Small deterministic hash used for star-field and special-sky seeds.
export function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
