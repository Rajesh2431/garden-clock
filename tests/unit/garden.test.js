import { describe, expect, it } from 'vitest';
import { GROW_MS, Garden } from '../../js/garden.js';
import { THEMES } from '../../js/themes.js';

function fakeCanvas(width = 1200, height = 800) {
  const context = new Proxy(
    {},
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
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height }),
  };
  return { canvas, context };
}

function buildGarden(seed = 42, width = 1200, height = 800, options = {}) {
  const { canvas } = fakeCanvas(width, height);
  const garden = new Garden(canvas, options);
  garden.W = width;
  garden.H = height;
  garden.build({ x: 300, y: 320, w: 600, h: 160 }, seed, THEMES.noir);
  return garden;
}

describe('Garden determinism', () => {
  it('reproduces the same garden for the same seed', () => {
    const first = buildGarden(42);
    const second = buildGarden(42);

    expect(first.vines).toHaveLength(second.vines.length);
    expect(first.vines[0].pts[5]).toEqual(second.vines[0].pts[5]);
    expect(first.vines.map((vine) => vine.pts)).toEqual(second.vines.map((vine) => vine.pts));
    expect(first.clusters).toEqual(second.clusters);
    expect(first.butterflies).toEqual(second.butterflies);
  });

  it('changes the garden when the seed changes', () => {
    const first = buildGarden(42);
    const second = buildGarden(43);
    expect(JSON.stringify(first.vines)).not.toBe(JSON.stringify(second.vines));
  });

  it('ignores the theme while generating geometry', () => {
    const garden = buildGarden(7);
    const before = JSON.stringify(garden.vines);
    garden.build(garden.box, 7, THEMES.glass);
    expect(JSON.stringify(garden.vines)).toBe(before);
  });

  it('builds quickly enough for an instant regrow', () => {
    const garden = buildGarden(99, 1440, 900);
    expect(garden.buildMs).toBeLessThan(50);
  });
});

describe('Garden composition', () => {
  it('grows vines, leaves, flowers, clusters and butterflies', () => {
    const garden = buildGarden(1234);
    expect(garden.vines.length).toBeGreaterThan(10);
    expect(garden.clusters.length).toBeGreaterThanOrEqual(18);
    expect(garden.clusters.length).toBeLessThanOrEqual(30);
    expect(garden.butterflies.length).toBeGreaterThanOrEqual(1);
    expect(garden.butterflies.length).toBeLessThanOrEqual(2);

    const regular = garden.vines.filter((vine) => !vine.clusterStem);
    expect(regular.some((vine) => vine.leaves.length > 0)).toBe(true);
    expect(regular.some((vine) => vine.flowers.some((flower) => flower.tip))).toBe(true);
  });

  it('keeps growing vines outside the padded clock box', () => {
    for (const seed of [1, 42, 1234, 9999]) {
      const garden = buildGarden(seed);
      const { box } = garden;
      for (const vine of garden.vines.filter((item) => !item.clusterStem)) {
        for (const [x, y] of vine.pts) {
          const inside = x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h;
          expect(inside, `seed ${seed} vine point ${x},${y}`).toBe(false);
        }
      }
    }
  });

  it('keeps cluster blooms inside the canvas', () => {
    const garden = buildGarden(1234, 360, 720);
    for (const cluster of garden.clusters) {
      expect(cluster.x).toBeGreaterThanOrEqual(0);
      expect(cluster.x).toBeLessThanOrEqual(garden.W);
      expect(cluster.y).toBeGreaterThanOrEqual(0);
      expect(cluster.y).toBeLessThanOrEqual(garden.H);
    }
  });

  it('skips butterflies and the growth delay in reduced-motion mode', () => {
    const garden = buildGarden(42, 1200, 800, { reducedMotion: true });
    expect(garden.butterflies).toEqual([]);
    expect(garden.t0).toBeLessThan(performance.now() - GROW_MS);
    expect(garden.reduced).toBe(true);
  });

  it('draws every theme without throwing', () => {
    const garden = buildGarden(42, 800, 600);
    garden.t0 = performance.now();
    for (const theme of Object.values(THEMES)) {
      expect(() => garden.draw(theme, performance.now() + 3000)).not.toThrow();
    }
  });
});

describe('Garden timing and wind', () => {
  it('reports vine progress with per-vine delay', () => {
    const garden = buildGarden();
    const vine = { delay: 0.5 };
    expect(garden.vineProgress(vine, 0.25)).toBe(0);
    expect(garden.vineProgress(vine, 0.75)).toBeCloseTo(0.5);
    expect(garden.vineProgress(vine, 1)).toBe(1);
    expect(garden.vineProgress({ delay: 1 }, 1)).toBe(1);
    expect(garden.vineProgress({ delay: 1 }, 0.99)).toBe(0);
  });

  it('clamps wind to a safe range', () => {
    const garden = buildGarden();
    garden.setWind(-10);
    expect(garden.wind).toBe(0);
    garden.setWind(80);
    expect(garden.wind).toBe(80);
    garden.setWind(500);
    expect(garden.wind).toBe(120);
    garden.setWind('nope');
    expect(garden.wind).toBe(0);
  });

  it('resizes the canvas for the capped device pixel ratio', () => {
    const { canvas, context } = fakeCanvas(800, 600);
    const garden = new Garden(canvas);
    const size = garden.resize();
    expect(size).toEqual({ width: 800, height: 600 });
    expect(garden.dpr).toBeGreaterThanOrEqual(1);
    expect(garden.dpr).toBeLessThanOrEqual(2);
    expect(canvas.width).toBe(Math.round(800 * garden.dpr));
    expect(canvas.height).toBe(Math.round(600 * garden.dpr));
    expect(context.setTransform).toBeTypeOf('function');
  });

  it('uses the default size when the canvas has no layout', () => {
    const garden = new Garden({ getContext: () => ({}) });
    const size = garden.resize();
    expect(size).toEqual({ width: 800, height: 600 });
  });
});
