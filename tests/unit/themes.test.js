import { afterEach, describe, expect, it } from 'vitest';
import {
  THEMES,
  THEME_KEYS,
  applyTheme,
  autoTheme,
  contrastRatio,
  getTheme,
  hexToRgb,
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
  it('uses neon for clear nights and noir for wet nights', () => {
    expect(autoTheme('clear', false, 23)).toBe('neon');
    expect(autoTheme('cloud', false, 23)).toBe('neon');
    expect(autoTheme('rain', false, 23)).toBe('noir');
    expect(autoTheme('storm', false, 23)).toBe('noir');
  });

  it('maps daytime weather to a theme', () => {
    expect(autoTheme('rain', true, 12)).toBe('noir');
    expect(autoTheme('storm', true, 12)).toBe('noir');
    expect(autoTheme('snow', true, 12)).toBe('glass');
    expect(autoTheme('fog', true, 12)).toBe('forest');
    expect(autoTheme('clear', true, 12)).toBe('glass');
    expect(autoTheme('cloud', true, 12)).toBe('sakura');
  });

  it('prefers sunset around dawn and dusk', () => {
    expect(autoTheme('clear', true, 6)).toBe('sunset');
    expect(autoTheme('clear', true, 17)).toBe('sunset');
    expect(autoTheme('cloud', true, 18)).toBe('sunset');
    expect(autoTheme('clear', true, 7)).toBe('glass');
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

  it('uses the system scheme before the first weather response', () => {
    const base = { theme: 'auto', kind: 'clear', isDay: true, hour: 12, hasWeather: false };
    expect(themeForState({ ...base, prefersDark: true })).toBe('noir');
    expect(themeForState({ ...base, prefersDark: false })).toBe('glass');
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
  it('has every auto result', () => {
    for (const kind of ['clear', 'cloud', 'fog', 'rain', 'storm', 'snow']) {
      for (const isDay of [true, false]) {
        for (const hour of [3, 12, 18]) {
          expect(THEMES[autoTheme(kind, isDay, hour)]).toBeDefined();
        }
      }
    }
  });

  it('exposes all six themes by name', () => {
    expect(THEME_KEYS).toEqual(['noir', 'glass', 'sakura', 'neon', 'sunset', 'forest']);
    for (const key of THEME_KEYS) {
      expect(THEMES[key].name).toBeTruthy();
      expect(THEMES[key].flowers.length).toBeGreaterThan(0);
      expect(THEMES[key].bloom).toMatch(/^(rose|daisy)$/);
    }
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
  it('writes CSS variables and body classes', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);

    applyTheme(THEMES.glass, 'glass');
    expect(document.documentElement.dataset.theme).toBe('glass');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#eef2f6');
    expect(document.documentElement.style.getPropertyValue('--digit')).toBe('#0d2036');
    expect(document.body.classList.contains('glass')).toBe(true);
    expect(document.body.classList.contains('light')).toBe(true);
    expect(meta.content).toBe('#eef2f6');

    applyTheme(THEMES.noir, 'noir');
    expect(document.body.classList.contains('glass')).toBe(false);
    expect(document.body.classList.contains('light')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--rose')).toBe('#ff1a00');
  });
});
