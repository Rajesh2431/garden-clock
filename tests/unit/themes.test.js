import { afterEach, describe, expect, it } from 'vitest';
import {
  THEMES,
  THEME_KEYS,
  applyTheme,
  autoTheme,
  contrastRatio,
  getTheme,
  hexToRgb,
  isDaytimeHour,
  themeContrast,
  themeForState,
} from '../../js/themes.js';

afterEach(() => {
  document.body.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  document.querySelector('meta[name="theme-color"]')?.remove();
});

describe('autoTheme', () => {
  it('uses the time of day for clear and cloudy nights', () => {
    expect(autoTheme('clear', false, 23)).toBe('night');
    expect(autoTheme('cloud', false, 23)).toBe('night');
    expect(autoTheme('clear', false, 18)).toBe('evening');
    expect(autoTheme('rain', false, 23)).toBe('noir');
    expect(autoTheme('storm', false, 23)).toBe('noir');
    expect(autoTheme('drizzle', false, 23)).toBe('noir');
  });

  it('maps daytime weather to a theme', () => {
    expect(autoTheme('rain', true, 12)).toBe('noir');
    expect(autoTheme('storm', true, 12)).toBe('noir');
    expect(autoTheme('drizzle', true, 12)).toBe('noir');
    expect(autoTheme('snow', true, 12)).toBe('glass');
    expect(autoTheme('fog', true, 12)).toBe('forest');
    expect(autoTheme('clear', true, 12)).toBe('afternoon');
    expect(autoTheme('cloud', true, 12)).toBe('afternoon');
  });

  it('uses morning, afternoon, evening and night phases', () => {
    expect(autoTheme('clear', true, 6)).toBe('morning');
    expect(autoTheme('clear', true, 8)).toBe('morning');
    expect(autoTheme('clear', true, 12)).toBe('afternoon');
    expect(autoTheme('clear', true, 16)).toBe('afternoon');
    expect(autoTheme('clear', true, 17)).toBe('evening');
    expect(autoTheme('clear', true, 20)).toBe('evening');
    expect(autoTheme('clear', true, 21)).toBe('night');
  });

  it('keeps sunset light after the day flag has dropped', () => {
    expect(autoTheme('clear', false, 18)).toBe('evening');
    expect(autoTheme('clear', false, 12)).toBe('night');
  });
});

describe('theme selection', () => {
  it('respects an explicit theme', () => {
    expect(
      themeForState({
        theme: 'sakura',
        kind: 'rain',
        isDay: true,
        hour: 12,
        hasWeather: true,
        prefersDark: true,
      }),
    ).toBe('sakura');
  });

  it('follows the local clock before (or without) a weather response', () => {
    const base = { theme: 'auto', kind: 'rain', isDay: true, hasWeather: false };
    expect(themeForState({ ...base, hour: 2 })).toBe('night');
    expect(themeForState({ ...base, hour: 8 })).toBe('morning');
    expect(themeForState({ ...base, hour: 14 })).toBe('afternoon');
    expect(themeForState({ ...base, hour: 19 })).toBe('evening');
    expect(themeForState({ ...base, hour: 23 })).toBe('night');
  });

  it('treats 06:00–17:59 as daylight until weather arrives', () => {
    expect(isDaytimeHour(5)).toBe(false);
    expect(isDaytimeHour(6)).toBe(true);
    expect(isDaytimeHour(17)).toBe(true);
    expect(isDaytimeHour(18)).toBe(false);
  });

  it('uses the weather rules once weather is loaded', () => {
    expect(
      themeForState({
        theme: 'auto',
        kind: 'snow',
        isDay: true,
        hour: 12,
        hasWeather: true,
        prefersDark: true,
      }),
    ).toBe('glass');
  });

  it('falls back to auto for an unknown theme key', () => {
    expect(
      themeForState({
        theme: 'missing',
        kind: 'rain',
        isDay: true,
        hour: 12,
        hasWeather: true,
        prefersDark: false,
      }),
    ).toBe('noir');
  });
});

describe('theme catalogue', () => {
  it('has every auto result and the new weather kind', () => {
    for (const kind of ['clear', 'cloud', 'fog', 'drizzle', 'rain', 'storm', 'snow']) {
      for (const isDay of [true, false]) {
        for (const hour of [3, 8, 12, 18, 23]) {
          expect(THEMES[autoTheme(kind, isDay, hour)]).toBeDefined();
        }
      }
    }
  });

  it('exposes all ten themes in menu order', () => {
    expect(THEME_KEYS).toEqual([
      'morning',
      'afternoon',
      'evening',
      'night',
      'noir',
      'glass',
      'sakura',
      'neon',
      'sunset',
      'forest',
    ]);
    for (const key of THEME_KEYS) {
      expect(THEMES[key].name).toBeTruthy();
      expect(THEMES[key].flowers.length).toBeGreaterThan(0);
      expect(THEMES[key].bloom).toMatch(
        /^(rose|daisy|tulip|cosmos|sunflower|lotus|bell|chrysanthemum|camellia)$/,
      );
    }
  });

  it('keeps Noir as the non-seasonal reference palette', () => {
    expect(THEMES.noir.seasonal).toBe(false);
    expect(THEME_KEYS.filter((key) => THEMES[key].seasonal === false)).toEqual(['noir']);
    expect(THEMES.morning.light).toBe(true);
    expect(THEMES.afternoon.light).toBe(true);
    expect(THEMES.glass.light).toBe(true);
  });

  it('returns noir for an unknown key', () => {
    expect(getTheme('missing')).toBe(THEMES.noir);
    expect(getTheme('glass')).toBe(THEMES.glass);
  });

  it('keeps digits at WCAG AA contrast in every theme', () => {
    for (const key of THEME_KEYS) {
      expect(themeContrast(THEMES[key]), key).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('not-a-color', '#ffffff')).toBe(0);
    expect(hexToRgb('#abc')).toEqual([170, 187, 204]);
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('red')).toBeNull();
  });
});

describe('applyTheme', () => {
  it('writes CSS variables and body classes for a light theme', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);

    applyTheme(THEMES.morning, 'morning');
    expect(document.documentElement.dataset.theme).toBe('morning');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#eef6ff');
    expect(document.documentElement.style.getPropertyValue('--digit')).toBe('#14263d');
    expect(document.body.classList.contains('light')).toBe(true);
    expect(document.body.classList.contains('glass')).toBe(false);
    expect(meta.content).toBe('#eef6ff');

    applyTheme(THEMES.noir, 'noir');
    expect(document.body.classList.contains('light')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--rose')).toBe('#ff1a00');
  });

  it('writes the glass and neon classes', () => {
    applyTheme(THEMES.glass, 'glass');
    expect(document.body.classList.contains('glass')).toBe(true);
    applyTheme(THEMES.neon, 'neon');
    expect(document.body.classList.contains('glass')).toBe(false);
    expect(document.body.classList.contains('neon')).toBe(true);
  });
});
