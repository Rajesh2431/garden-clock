import { describe, expect, it } from 'vitest';
import { FLOWER_SPECIES, GROW_MS, Garden, MAX_EXTRA_GROWTH } from '../../js/garden.js';
import { SEASON_KEYS } from '../../js/almanac.js';
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
  const { theme = THEMES.noir, season = 'spring', growth = 0, ...gardenOptions } = options;
  const { canvas } = fakeCanvas(width, height);
  const garden = new Garden(canvas, gardenOptions);
  garden.W = width;
  garden.H = height;
  garden.build({ x: 300, y: 320, w: 600, h: 160 }, seed, theme, { season, growth });
  return garden;
}

function geometryOf(garden) {
  const vines = garden.vines.map((vine) => ({
    pts: vine.pts,
    leaves: vine.leaves,
    flowers: vine.flowers.map(({ species: _species, ...rest }) => rest),
    branches: vine.branches,
    delay: vine.delay,
    width: vine.width,
    depth: vine.depth,
    phase: vine.phase,
    tip: vine.tip,
  }));
  const clusters = garden.clusters.map(({ species: _species, ...rest }) => rest);
  return { vines, clusters };
}

function speciesOf(garden) {
  return [
    ...garden.vines.flatMap((vine) => vine.flowers.map((flower) => flower.species)),
    ...garden.clusters.map((cluster) => cluster.species),
  ];
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
    const before = geometryOf(garden);
    garden.build(garden.box, 7, THEMES.glass, { season: 'spring' });
    expect(geometryOf(garden)).toEqual(before);
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

  it('draws every flower species without throwing', () => {
    const garden = buildGarden(42);
    const timestamp = performance.now();
    for (const species of FLOWER_SPECIES) {
      expect(() =>
        garden.drawFlower(garden.x, 200, 200, 20, 0.2, THEMES.glass, 1.2, 1, 3, species),
      ).not.toThrow();
    }
    expect(garden.draw).toBeTypeOf('function');
    expect(timestamp).toBeGreaterThan(0);
  });
});

describe('Garden species and seasons', () => {
  it('offers nine distinct species', () => {
    expect(new Set(FLOWER_SPECIES).size).toBe(9);
    expect(FLOWER_SPECIES).toContain('sunflower');
    expect(FLOWER_SPECIES).toContain('chrysanthemum');
  });

  it('draws from the seasonal mix', () => {
    const seasonal = {};
    for (const season of SEASON_KEYS) {
      const seen = new Set();
      for (let seed = 1; seed <= 6; seed += 1) {
        for (const species of speciesOf(buildGarden(seed, 1200, 800, { theme: THEMES.glass, season }))) {
          seen.add(species);
        }
      }
      seasonal[season] = seen;
    }
    expect(seasonal.spring.has('tulip')).toBe(true);
    expect(seasonal.summer.has('sunflower')).toBe(true);
    expect(seasonal.autumn.has('chrysanthemum')).toBe(true);
    expect(seasonal.winter.has('camellia')).toBe(true);
  });

  it('covers every species across the four seasons', () => {
    const seen = new Set();
    for (const season of SEASON_KEYS) {
      for (let seed = 1; seed <= 4; seed += 1) {
        for (const species of speciesOf(buildGarden(seed, 1200, 800, { theme: THEMES.glass, season }))) {
          seen.add(species);
        }
      }
    }
    expect([...seen].sort()).toEqual([...FLOWER_SPECIES].sort());
  });

  it('keeps the reference noir garden to roses and daisies', () => {
    for (const season of SEASON_KEYS) {
      const garden = buildGarden(1234, 1200, 800, { theme: THEMES.noir, season });
      expect(speciesOf(garden).every((species) => ['rose', 'daisy'].includes(species))).toBe(true);
      expect(garden.clusters.every((cluster) => cluster.species === 'rose')).toBe(true);
    }
  });
});

describe('Continuous growth', () => {
  it('restores saved growth before the first draw', () => {
    const base = buildGarden(2026);
    const grown = buildGarden(2026, 1200, 800, { growth: 5 });
    expect(grown.extraGrowth).toBe(5);
    expect(grown.vines.length).toBe(base.vines.length + 5);
  });

  it('caps persisted growth and stops adding vines at the cap', () => {
    const garden = buildGarden(2026);
    garden.restoreGrowth(MAX_EXTRA_GROWTH + 12);
    expect(garden.extraGrowth).toBe(MAX_EXTRA_GROWTH);
    expect(garden.growOne()).toBeNull();
    expect(garden.extraGrowth).toBe(MAX_EXTRA_GROWTH);
  });

  it('generates deterministic extra vines', () => {
    const first = buildGarden(77);
    const second = buildGarden(77);
    const firstVine = first.growOne({ instant: true });
    const secondVine = second.growOne({ instant: true });
    expect(firstVine.pts).toEqual(secondVine.pts);
    expect(firstVine.flowers.map((flower) => flower.species)).toEqual(
      secondVine.flowers.map((flower) => flower.species),
    );
    expect(first.extraGrowth).toBe(1);
    expect(firstVine.bornAt).toBe(0);
  });

  it('accepts a short growth at the scene edge', () => {
    const garden = buildGarden(5, 300, 300);
    const vine = garden.growOne({ instant: true });
    expect(vine).not.toBeNull();
    expect(vine.pts.length).toBeGreaterThanOrEqual(4);
    expect(garden.extraGrowth).toBe(1);
  });
});

describe('Click blooms and butterflies', () => {
  it('blooms where the visitor clicks and sends a butterfly', () => {
    const garden = buildGarden(11);
    const before = garden.butterflies.length;
    const flower = garden.bloomAt(40, 40);
    expect(flower.x).toBe(40);
    expect(flower.y).toBe(40);
    expect(garden.extras).toContain(flower);
    expect(garden.butterflies.length).toBe(before + 1);
    expect(garden.butterflies.at(-1).fromX).toBeDefined();
  });

  it('moves a bloom below the clock instead of obscuring the digits', () => {
    const garden = buildGarden(11);
    const { box } = garden;
    const flower = garden.bloomAt(box.x + box.w / 2, box.y + box.h / 2);
    expect(flower.y).toBeGreaterThan(box.y + box.h);
    expect(flower.y).toBeLessThan(garden.H);
  });

  it('caps blooms and visitors', () => {
    const garden = buildGarden(12);
    for (let i = 0; i < 60; i += 1) garden.bloomAt(30 + i, 30 + i);
    expect(garden.extras).toHaveLength(48);
    expect(garden.butterflies.length).toBeLessThanOrEqual(8);
  });

  it('keeps clicked blooms and the garden age when the same garden is rebuilt', () => {
    const garden = buildGarden(21);
    garden.t0 = performance.now() - 60_000;
    const age = garden.t0;
    const flower = garden.bloomAt(40, 40);
    const visitors = garden.butterflies.length;
    garden.build(garden.box, 21, THEMES.sakura, { season: 'autumn' });
    expect(garden.t0).toBe(age);
    expect(garden.extras).toHaveLength(1);
    expect(garden.extras[0]).toMatchObject({ x: flower.x, y: flower.y, species: flower.species });
    expect(garden.butterflies.length).toBe(visitors);
  });

  it('clears clicked blooms and replays growth for a new seed', () => {
    const garden = buildGarden(21);
    garden.t0 = performance.now() - 60_000;
    garden.bloomAt(40, 40);
    garden.build(garden.box, 22, THEMES.noir, { season: 'spring' });
    expect(garden.extras).toEqual([]);
    expect(garden.t0).toBeGreaterThan(performance.now() - 1000);
  });

  it('moves clicked blooms with a resize and drops any that would cover the clock', () => {
    const garden = buildGarden(21);
    garden.bloomAt(100, 100);
    garden.bloomAt(1100, 300);
    garden.W = 600;
    garden.H = 400;
    const box = { x: 500, y: 100, w: 90, h: 80 };
    garden.build(box, 21, THEMES.noir, { season: 'spring' });
    // (100,100) → (50,50) survives; (1100,300) → (550,150) is inside the new box.
    expect(garden.extras).toHaveLength(1);
    expect(garden.extras[0].x).toBeCloseTo(50);
    expect(garden.extras[0].y).toBeCloseTo(50);
  });

  it('does not summon butterflies in reduced-motion mode', () => {
    const garden = buildGarden(12, 1200, 800, { reducedMotion: true });
    const flower = garden.bloomAt(40, 40);
    expect(flower).toBeTruthy();
    expect(garden.butterflies).toEqual([]);
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
