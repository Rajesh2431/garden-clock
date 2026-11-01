import { describe, expect, it } from 'vitest';
import { FX } from '../../js/fx.js';
import { THEMES } from '../../js/themes.js';

function fakeContext() {
  const gradient = { addColorStop: () => {} };
  const base = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    measureText: () => ({ width: 0 }),
  };
  return new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

function fakeCanvas(width = 1000, height = 700) {
  const context = fakeContext();
  return {
    context,
    canvas: {
      width: 0,
      height: 0,
      getContext: () => context,
      getBoundingClientRect: () => ({ width, height }),
    },
  };
}

function buildFx(options = {}) {
  const { canvas } = fakeCanvas();
  return new FX(canvas, { seed: 42, ...options });
}

describe('FX particle budgets', () => {
  it('builds the documented counts', () => {
    const fx = buildFx();
    fx.set('clear', true);
    expect(fx.particles).toHaveLength(34);

    fx.set('clear', false);
    expect(fx.particles).toHaveLength(0);

    fx.set('cloud', true);
    expect(fx.particles).toHaveLength(7);

    fx.set('fog', true);
    expect(fx.particles).toHaveLength(6);

    fx.set('drizzle', true);
    expect(fx.particles).toHaveLength(90);

    fx.set('rain', true);
    expect(fx.particles).toHaveLength(230);

    fx.set('storm', true);
    expect(fx.particles).toHaveLength(340);

    fx.set('snow', true);
    expect(fx.particles).toHaveLength(150);
  });

  it('halves the count on low-power devices', () => {
    const fx = buildFx({ lowPower: true });
    fx.set('rain', true);
    expect(fx.particles).toHaveLength(115);
    fx.set('storm', true);
    expect(fx.particles).toHaveLength(170);
    fx.set('clear', false);
    expect(fx.particles).toHaveLength(0);
  });

  it('uses a calm particle budget with reduced motion', () => {
    const fx = buildFx({ reducedMotion: true });
    fx.set('rain', true);
    expect(fx.particles).toHaveLength(64);
    fx.set('clear', false);
    expect(fx.particles).toHaveLength(0);
  });

  it('couples the rain slant to wind speed', () => {
    const fx = buildFx();
    fx.set('rain', true, 24);
    expect(fx.lean).toBe(6);
    fx.set('rain', true, 200);
    expect(fx.lean).toBe(30);
    fx.set('rain', true, -20);
    expect(fx.lean).toBe(0);
  });
});

describe('FX rendering', () => {
  it('draws every weather and theme combination', () => {
    const fx = buildFx();
    const timestamp = performance.now();
    for (const kind of ['clear', 'cloud', 'fog', 'drizzle', 'rain', 'storm', 'snow']) {
      for (const day of [true, false]) {
        for (const theme of Object.values(THEMES)) {
          fx.set(kind, day, 18, theme);
          expect(() => fx.draw(0.016, timestamp, theme)).not.toThrow();
        }
      }
    }
  });

  it('keeps a lightning bolt in one place while its flash fades', () => {
    const fx = buildFx();
    fx.set('storm', false, 10);
    fx.nextBolt = 0.01;
    fx.draw(0.05, performance.now(), THEMES.noir);
    expect(fx.flash).toBeGreaterThan(0);
    const { boltX, boltSeed } = fx;
    for (let frame = 1; frame < 5; frame += 1) {
      fx.draw(0.05, performance.now() + frame * 50, THEMES.noir);
      expect(fx.boltX).toBe(boltX);
      expect(fx.boltSeed).toBe(boltSeed);
    }
  });

  it('does not flash lightning in reduced-motion mode', () => {
    const fx = buildFx({ reducedMotion: true });
    fx.set('storm', false, 10);
    fx.nextBolt = 1;
    for (let frame = 0; frame < 120; frame += 1) {
      fx.draw(0.05, performance.now() + frame * 50, THEMES.noir);
    }
    expect(fx.nextBolt).toBe(1);
    expect(fx.flash).toBe(0);
  });

  it('keeps rain particles within the scene', () => {
    const fx = buildFx();
    fx.set('rain', true, 20, THEMES.noir);
    for (let frame = 0; frame < 300; frame += 1) {
      fx.draw(0.05, performance.now() + frame * 50, THEMES.noir);
    }
    for (const particle of fx.particles) {
      expect(particle.x).toBeGreaterThanOrEqual(-100);
      expect(particle.x).toBeLessThanOrEqual(fx.W + 30);
      expect(particle.y).toBeGreaterThanOrEqual(-100);
      expect(particle.y).toBeLessThanOrEqual(fx.H + 24);
    }
  });

  it('leaves stars and the moon to the sky layer', () => {
    const fx = buildFx();
    fx.set('clear', false);
    expect(fx.stars).toBeUndefined();
    expect(fx.moon).toBeUndefined();
  });

  it('does nothing without a canvas context', () => {
    const fx = new FX(null);
    fx.resize();
    fx.set('rain', true, 5);
    expect(() => fx.draw(0.016, 0, THEMES.noir)).not.toThrow();
  });
});

describe('FX resize', () => {
  it('sizes the backing canvas and returns the CSS size', () => {
    const { canvas } = fakeCanvas(900, 600);
    const fx = new FX(canvas, { seed: 1 });
    const size = fx.resize();
    expect(size).toEqual({ width: 900, height: 600 });
    expect(canvas.width).toBe(Math.round(900 * fx.dpr));
    expect(canvas.height).toBe(Math.round(600 * fx.dpr));
    expect(fx.dpr).toBeGreaterThanOrEqual(1);
    expect(fx.dpr).toBeLessThanOrEqual(2);
  });
});
