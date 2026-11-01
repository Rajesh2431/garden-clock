import { describe, expect, it } from 'vitest';
import { Sky } from '../../js/sky.js';
import { THEMES } from '../../js/themes.js';

function fakeContext() {
  const gradient = { addColorStop: () => {} };
  return new Proxy(
    {
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient,
      measureText: () => ({ width: 0 }),
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        return () => {};
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      },
    },
  );
}

function fakeCanvas(width = 1200, height = 800) {
  let context = fakeContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height }),
  };
  return {
    canvas,
    get context() {
      return context;
    },
    set dimensions({ width: nextWidth, height: nextHeight }) {
      canvas.getBoundingClientRect = () => ({ width: nextWidth, height: nextHeight });
      context = fakeContext();
    },
  };
}

function buildSky(width = 1200, height = 800, options = {}) {
  const { canvas } = fakeCanvas(width, height);
  const sky = new Sky(canvas, options);
  sky.resize();
  return sky;
}

const FIXED_DATE = new Date('2026-10-27T06:00:00Z');

describe('Sky setup', () => {
  it('sizes the backing canvas for the capped device pixel ratio', () => {
    const { canvas } = fakeCanvas(900, 700);
    const sky = new Sky(canvas);
    const size = sky.resize();
    expect(size).toEqual({ width: 900, height: 700 });
    expect(canvas.width).toBe(Math.round(900 * sky.dpr));
    expect(canvas.height).toBe(Math.round(700 * sky.dpr));
    expect(sky.dpr).toBeGreaterThanOrEqual(1);
    expect(sky.dpr).toBeLessThanOrEqual(2);
  });

  it('keeps working without a canvas context', () => {
    const sky = new Sky(null);
    sky.resize();
    expect(() => sky.draw(0)).not.toThrow();
  });
});

describe('Sky state and stars', () => {
  it('builds a deterministic star field for the date and phase', () => {
    const first = buildSky();
    const second = buildSky();
    first.set({ date: FIXED_DATE, phase: 'night', kind: 'clear', season: 'autumn' });
    second.set({ date: FIXED_DATE, phase: 'night', kind: 'clear', season: 'autumn' });
    expect(first.stars).toHaveLength(132);
    expect(first.stars).toEqual(second.stars);
    expect(first.constellation.key).toBe('scorpius');
  });

  it('rebuilds when the sky key changes and skips identical updates', () => {
    const sky = buildSky();
    const options = { date: FIXED_DATE, phase: 'night', kind: 'clear', season: 'autumn' };
    expect(sky.set(options)).toBe(true);
    const stars = sky.stars;
    expect(sky.set(options)).toBe(false);
    expect(sky.stars).toBe(stars);
    expect(sky.set({ ...options, kind: 'rain' })).toBe(true);
    expect(sky.set({ ...options, date: new Date('2026-10-28T06:00:00Z') })).toBe(true);
  });

  it('rebuilds star positions after a resize', () => {
    const sky = buildSky(1200, 800);
    sky.set({ date: FIXED_DATE, phase: 'night', kind: 'clear', season: 'autumn' });
    expect(sky.stars[0].x).toBeGreaterThanOrEqual(0);
    sky.c.getBoundingClientRect = () => ({ width: 600, height: 400 });
    sky.resize();
    expect(sky.stars).toEqual([]);
    sky.set({ date: FIXED_DATE, phase: 'night', kind: 'clear', season: 'autumn' });
    expect(sky.stars.every((star) => star.x <= 600 && star.y <= 400)).toBe(true);
  });

  it('halves the star budget on low-power devices', () => {
    const sky = buildSky(1200, 800, { lowPower: true });
    sky.set({ date: FIXED_DATE, phase: 'night', kind: 'clear', season: 'autumn' });
    expect(sky.stars).toHaveLength(66);
    sky.setLowPower(false);
    sky.set({ date: FIXED_DATE, phase: 'night', kind: 'clear', season: 'autumn' });
    expect(sky.stars).toHaveLength(132);
  });

  it('uses a calmer reduced-motion star count', () => {
    const sky = buildSky(1200, 800, { reducedMotion: true });
    sky.set({ date: FIXED_DATE, phase: 'night', kind: 'clear', season: 'autumn' });
    expect(sky.stars).toHaveLength(95);
  });
});

describe('Sky visibility and rendering', () => {
  it('describes visibility for every weather kind', () => {
    const sky = buildSky();
    expect(sky.visibility()).toBe(1);
    const expected = {
      clear: 1,
      cloud: 0.48,
      snow: 0.24,
      drizzle: 0.14,
      rain: 0.14,
      storm: 0.07,
      fog: 0.08,
    };
    for (const [kind, value] of Object.entries(expected)) {
      sky.kind = kind;
      expect(sky.visibility()).toBe(value);
    }
    sky.kind = 'unknown';
    expect(sky.visibility()).toBe(0.7);
  });

  it('draws every phase, weather and light theme without throwing', () => {
    const sky = buildSky();
    for (const phase of ['morning', 'afternoon', 'evening', 'night']) {
      for (const kind of ['clear', 'cloud', 'fog', 'drizzle', 'rain', 'storm', 'snow']) {
        for (const theme of [THEMES.noir, THEMES.morning, THEMES.night]) {
          sky.set({ date: FIXED_DATE, phase, kind, theme, season: 'autumn' });
          expect(() => sky.draw(performance.now())).not.toThrow();
        }
      }
    }
  });

  it('rebuilds lazily before drawing after a resize', () => {
    const sky = buildSky(800, 600);
    sky.set({ date: FIXED_DATE, phase: 'night', kind: 'clear', season: 'autumn' });
    sky.c.getBoundingClientRect = () => ({ width: 320, height: 240 });
    sky.resize();
    sky.draw(0);
    expect(sky.stars.length).toBeGreaterThan(0);
    expect(sky.stars.every((star) => star.x <= 320 && star.y <= 240)).toBe(true);
  });
});
