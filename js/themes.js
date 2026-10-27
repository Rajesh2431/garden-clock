// Themes drive both CSS custom properties and the canvas painter.

export const THEMES = {
  noir: {
    name: 'Noir Roses',
    bg: '#000000',
    bg2: '#05050a',
    stage: 'radial-gradient(120% 95% at 50% 38%, #07070f 0%, #000 68%)',
    vine: '#3355ff',
    leaf: '#3355ff',
    flowers: ['#ff1a00', '#ff2d12', '#d90f00'],
    swirl: '#ff9a8c',
    bloom: 'rose',
    center: '#ffd7a8',
    digit: '#ffffff',
    glow: 'none',
    ui: '#ffffff',
    muted: 'rgba(255,255,255,.62)',
    panel: 'rgba(8,8,12,.62)',
    border: 'rgba(255,255,255,.16)',
    accent: '#3355ff',
    contrastBg: '#000000',
  },
  glass: {
    name: 'Glass Marble',
    bg: '#eef2f6',
    bg2: '#ffffff',
    stage: 'linear-gradient(160deg, #ffffff 0%, #e6edf5 100%)',
    vine: '#2f6bff',
    leaf: '#3b7bff',
    flowers: ['#ff5c7a', '#b28bff', '#18c5b5', '#ffc533', '#e0309a', '#5ab8ff'],
    swirl: 'rgba(255,255,255,.82)',
    bloom: 'rose',
    center: '#ffe08a',
    digit: '#0d2036',
    glow: '0 0 18px rgba(255,255,255,.9)',
    ui: '#12202e',
    muted: '#4a6178',
    panel: 'rgba(255,255,255,.56)',
    border: 'rgba(255,255,255,.82)',
    accent: '#2f6bff',
    contrastBg: '#eef2f6',
    glass: true,
    light: true,
  },
  sakura: {
    name: 'Sakura Night',
    bg: '#1b0f17',
    bg2: '#2a1521',
    stage: 'radial-gradient(110% 90% at 50% 45%, #2a1622 0%, #1b0f17 70%)',
    vine: '#7bd88f',
    leaf: '#5fc27a',
    flowers: ['#ffb7c9', '#ff8fab', '#ffd6e0', '#f7a8c4'],
    swirl: '#fff0f5',
    bloom: 'daisy',
    center: '#ffcf33',
    digit: '#ffeef3',
    glow: '0 0 24px rgba(255,150,180,.45)',
    ui: '#ffeef3',
    muted: 'rgba(255,238,243,.6)',
    panel: 'rgba(255,255,255,.08)',
    border: 'rgba(255,255,255,.18)',
    accent: '#ff9fbc',
    contrastBg: '#1b0f17',
  },
  neon: {
    name: 'Neon Bloom',
    bg: '#05040f',
    bg2: '#0a0520',
    stage: 'radial-gradient(100% 90% at 50% 35%, #0a0930 0%, #05040f 70%)',
    vine: '#00e5ff',
    leaf: '#00b8d4',
    flowers: ['#ff2bd6', '#9d4dff', '#39ff88', '#ff5cf0'],
    swirl: '#ffffff',
    bloom: 'rose',
    center: '#ffe66d',
    digit: '#eaffff',
    glow: '0 0 28px #00e5ff, 0 0 70px rgba(0,229,255,.38)',
    ui: '#eaffff',
    muted: 'rgba(234,255,255,.62)',
    panel: 'rgba(0,229,255,.08)',
    border: 'rgba(0,229,255,.28)',
    accent: '#00e5ff',
    contrastBg: '#05040f',
    neon: true,
  },
  sunset: {
    name: 'Sunset',
    bg: '#2b1055',
    bg2: '#ff7e5f',
    stage: 'linear-gradient(180deg, #2b1055 0%, #7a2d6b 55%, #ff7e5f 100%)',
    vine: '#ffd166',
    leaf: '#ffb347',
    flowers: ['#ff4d6d', '#ffd166', '#ffffff', '#ff9f68'],
    swirl: 'rgba(255,255,255,.65)',
    bloom: 'rose',
    center: '#ffe9a8',
    digit: '#fff6e8',
    glow: '0 0 24px rgba(255,170,90,.55)',
    ui: '#fff6e8',
    muted: 'rgba(255,246,232,.65)',
    panel: 'rgba(40,15,60,.4)',
    border: 'rgba(255,255,255,.24)',
    accent: '#ffd166',
    contrastBg: '#2b1055',
    sunset: true,
  },
  forest: {
    name: 'Forest',
    bg: '#0d1f14',
    bg2: '#17351f',
    stage: 'radial-gradient(110% 90% at 50% 40%, #17351f 0%, #0d1f14 70%)',
    vine: '#6fcf6f',
    leaf: '#4caf50',
    flowers: ['#ffd23f', '#ff7b54', '#f2f2f2', '#ffb347'],
    swirl: '#fff7d6',
    bloom: 'daisy',
    center: '#ffcf33',
    digit: '#eaffea',
    glow: '0 0 20px rgba(120,255,140,.28)',
    ui: '#eaffea',
    muted: 'rgba(234,255,234,.6)',
    panel: 'rgba(255,255,255,.07)',
    border: 'rgba(255,255,255,.16)',
    accent: '#6fcf6f',
    contrastBg: '#0d1f14',
  },
};

export const THEME_KEYS = Object.keys(THEMES);
export const THEME_NAMES = Object.fromEntries(THEME_KEYS.map((key) => [key, THEMES[key].name]));

export function getTheme(key) {
  return THEMES[key] || THEMES.noir;
}

// Auto theme rules from the project brief.
export function autoTheme(kind, isDay, hour) {
  if (!isDay) return kind === 'rain' || kind === 'storm' ? 'noir' : 'neon';
  if (kind === 'rain' || kind === 'storm') return 'noir';
  if (kind === 'snow') return 'glass';
  if (kind === 'fog') return 'forest';
  if (hour >= 17 || hour < 7) return 'sunset';
  return kind === 'clear' ? 'glass' : 'sakura';
}

export function themeForState({ theme, kind, isDay, hour, hasWeather, prefersDark }) {
  if (theme && theme !== 'auto' && THEMES[theme]) return theme;
  if (!hasWeather) return prefersDark ? 'noir' : 'glass';
  return autoTheme(kind, isDay, hour);
}

export function applyTheme(theme, key) {
  const target = theme || THEMES.noir;
  const root = document.documentElement;
  const style = root.style;
  const vars = {
    '--bg': target.bg,
    '--stage-bg': target.stage,
    '--digit': target.digit,
    '--glow': target.glow,
    '--ui': target.ui,
    '--muted': target.muted,
    '--panel': target.panel,
    '--border': target.border,
    '--accent': target.accent,
    '--rose': target.flowers[0],
  };
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);

  if (key) root.dataset.theme = key;
  const body = document.body;
  body.classList.toggle('glass', !!target.glass);
  body.classList.toggle('neon', !!target.neon);
  body.classList.toggle('sunset', !!target.sunset);
  body.classList.toggle('light', !!target.light);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', target.bg);
}

// Simple WCAG contrast helper used by the theme test suite.
function channel(value) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const value = hex.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
  if (value.length === 3) {
    return [0, 1, 2].map((i) => parseInt(value[i] + value[i], 16));
  }
  const number = Number.parseInt(value, 16);
  if (!Number.isFinite(number)) return null;
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

export function contrastRatio(foreground, background) {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) return 0;
  const luminance = (rgb) => {
    const r = channel(rgb[0]);
    const g = channel(rgb[1]);
    const b = channel(rgb[2]);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

export function themeContrast(theme) {
  return contrastRatio(theme.digit, theme.contrastBg || theme.bg);
}
