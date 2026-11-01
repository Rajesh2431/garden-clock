// Procedural garden: vines grow from the page edges toward the clock, leaves
// alternate along each stem, and roses or daisies bloom as the growth front
// reaches them. Everything is driven by a seed, so a link reproduces a garden.

import { clamp, easeOutBack, easeOutCubic, mulberry32 } from './rand.js';
import { seasonInfo } from './almanac.js';

const TAU = Math.PI * 2;
export const GROW_MS = 7000;
export const EXTRA_GROW_MS = 2600;
export const MAX_EXTRA_GROWTH = 28;
export const FLOWER_SPECIES = [
  'rose',
  'daisy',
  'tulip',
  'cosmos',
  'sunflower',
  'lotus',
  'bell',
  'chrysanthemum',
  'camellia',
];

function pickSpecies(rnd, theme, season, cluster = false) {
  const fallback = theme?.bloom || 'rose';
  if (theme?.seasonal === false) {
    if (cluster) return 'rose';
    return rnd() < 0.78 ? 'rose' : 'daisy';
  }
  const mix = seasonInfo(season).flowers;
  if (cluster) return rnd() < 0.36 ? fallback : mix[Math.floor(rnd() * mix.length)];
  if (rnd() < 0.46) return fallback;
  return mix[Math.floor(rnd() * mix.length)] || fallback;
}

function normalizeBox(box, width, height) {
  const fallback = { x: width * 0.25, y: height * 0.4, w: width * 0.5, h: height * 0.2 };
  const source = box || fallback;
  return {
    x: clamp(Number(source.x) || 0, 0, width),
    y: clamp(Number(source.y) || 0, 0, height),
    w: clamp(Number(source.w) || 0, 10, width),
    h: clamp(Number(source.h) || 0, 10, height),
  };
}

function sameBox(a, b) {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1
  );
}

// Clicked blooms survive a rebuild of the same garden. After a resize they move
// proportionally, and any that would now cover the digits are dropped.
function carryExtras(previous, width, height, box) {
  const sx = previous.W ? width / previous.W : 1;
  const sy = previous.H ? height / previous.H : 1;
  return previous.extras
    .map((flower) => ({
      ...flower,
      x: clamp(flower.x * sx, 14, width - 14),
      y: clamp(flower.y * sy, 14, height - 14),
    }))
    .filter(
      (flower) =>
        !(flower.x > box.x && flower.x < box.x + box.w && flower.y > box.y && flower.y < box.y + box.h),
    );
}

function makeClusterStem(cx, cy, scale, rnd, delay) {
  let x = cx + (rnd() - 0.5) * 48 * scale;
  let y = cy + (rnd() * 0.4 + 0.2) * 80 * scale;
  let angle = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
  const pts = [[x, y]];
  const leaves = [];
  const steps = 16 + Math.floor(rnd() * 10);
  for (let k = 0; k < steps; k += 1) {
    angle += Math.sin(k * 0.6 + rnd()) * 0.16;
    x += Math.cos(angle) * 3.4 * scale;
    y += Math.sin(angle) * 3.4 * scale;
    pts.push([x, y]);
    if (k % 5 === 3) {
      leaves.push({ i: k, side: k % 10 < 5 ? 1 : -1, bend: 0.5 + rnd() * 0.35, size: 8 + rnd() * 8 });
    }
  }
  return {
    pts,
    leaves,
    flowers: [],
    delay,
    width: Math.max(1, 1.1 * scale),
    depth: 1,
    phase: rnd() * TAU,
    clusterStem: true,
  };
}

export class Garden {
  constructor(canvas, options = {}) {
    this.c = canvas;
    this.x = canvas?.getContext?.('2d') || null;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.vines = [];
    this.clusters = [];
    this.butterflies = [];
    this.box = null;
    this.theme = null;
    this.season = 'spring';
    this.seed = 1;
    this.t0 = 0;
    this.wind = 0;
    this.reduced = !!options.reducedMotion;
    this.lowPower = !!options.lowPower;
    this.stemsCache = null;
    this.buildMs = 0;
    this.extraGrowth = 0;
    this.extras = [];
    this.newestGrowthAt = 0;
    this.builtW = 0;
    this.builtH = 0;
  }

  resize() {
    const rect = this.c?.getBoundingClientRect?.() || { width: 800, height: 600 };
    this.W = Math.max(1, rect.width || 800);
    this.H = Math.max(1, rect.height || 600);
    const dpr = clamp(globalThis.devicePixelRatio || 1, 1, 2);
    this.dpr = dpr;
    const pixelWidth = Math.max(1, Math.round(this.W * dpr));
    const pixelHeight = Math.max(1, Math.round(this.H * dpr));
    if (this.c) {
      if (this.c.width !== pixelWidth) this.c.width = pixelWidth;
      if (this.c.height !== pixelHeight) this.c.height = pixelHeight;
    }
    if (this.x?.setTransform) this.x.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.stemsCache = null;
    return { width: this.W, height: this.H };
  }

  setWind(windKmh) {
    this.wind = Number.isFinite(windKmh) ? clamp(windKmh, 0, 120) : 0;
  }

  setReduced(reduced) {
    this.reduced = !!reduced;
    if (this.reduced) {
      this.t0 = performance.now() - GROW_MS * 2;
      this.stemsCache = null;
      this.butterflies = [];
    }
  }

  setLowPower(value) {
    this.lowPower = !!value;
  }

  /**
   * Build a complete garden for a clock bounding box. The same seed and size
   * always produce identical vines, leaves, flowers and visitors.
   */
  build(box, seed = Date.now(), theme, options = {}) {
    const started = performance.now();
    if (!this.W || !this.H) this.resize();
    const previous = {
      seed: this.seed,
      W: this.builtW,
      H: this.builtH,
      box: this.box,
      t0: this.t0,
      extras: this.extras,
      visitors: this.butterflies.filter((item) => item.fromX != null),
      built: this.vines.length > 0,
    };
    this.theme = theme || this.theme;
    this.season = options.season || this.season || 'spring';
    this.seed = Number(seed) >>> 0 || 1;
    this.box = normalizeBox(box, this.W, this.H);
    const sameSeed = previous.built && previous.seed === this.seed;
    // A theme, season or toggle change rebuilds with the same seed and layout.
    // Keep the garden's age in that case so it does not replay the growth.
    const sameLayout =
      sameSeed && previous.W === this.W && previous.H === this.H && sameBox(previous.box, this.box);
    this.vines = [];
    this.clusters = [];
    this.butterflies = [];
    this.extras = sameSeed ? carryExtras(previous, this.W, this.H, this.box) : [];
    this.extraGrowth = 0;
    this.newestGrowthAt = 0;
    this.stemsCache = null;
    this.builtW = this.W;
    this.builtH = this.H;
    if (this.reduced) this.t0 = performance.now() - GROW_MS * 2;
    else this.t0 = sameLayout ? previous.t0 : performance.now();

    const rnd = mulberry32(this.seed);
    // Species are drawn from a separate stream so changing a theme never moves
    // a vine, leaf or flower position.
    const speciesRnd = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
    const { W, H, box: clock } = this;
    const scale = clamp(Math.min(W, H) / 900, 0.58, 1.35);
    const step = clamp(W / 150, 4, 8);
    const vineCount = W < 700 ? 9 : W < 1200 ? 12 : 15;
    const spawners = [
      () => [rnd() * W * 0.3, -14],
      () => [W * 0.3 + rnd() * W * 0.4, -14],
      () => [W * 0.68 + rnd() * W * 0.32, -14],
      () => [-14, H * 0.16 + rnd() * H * 0.68],
      () => [W + 14, H * 0.14 + rnd() * H * 0.58],
      () => [rnd() * W * 0.22, H + 14],
    ];
    const inside = (x, y) => x > clock.x && x < clock.x + clock.w && y > clock.y && y < clock.y + clock.h;
    const outsideScene = (x, y) => x < -W * 0.25 || x > W * 1.25 || y < -H * 0.25 || y > H * 1.25;
    const totalLimit = Math.round(vineCount * 1.7);

    const generate = (options) => {
      const { startX, startY, targetX, targetY, maxSteps, width, delay, depth } = options;
      let x = startX;
      let y = startY;
      let angle = Math.atan2(targetY - y, targetX - x) + (rnd() - 0.5) * (depth ? 1.1 : 0.55);
      let wobble = rnd() * TAU;
      const pts = [[x, y]];
      const leafSeeds = [];
      const flowerSeeds = [];
      const branches = [];
      const steps = maxSteps;

      for (let k = 0; k < steps; k += 1) {
        wobble += 0.11 + rnd() * 0.035;
        const desired = Math.atan2(targetY - y, targetX - x);
        const diff = Math.atan2(Math.sin(desired - angle), Math.cos(desired - angle));
        angle += diff * (depth ? 0.018 : 0.03);
        angle += Math.sin(wobble) * (0.1 + rnd() * 0.025) + (rnd() - 0.5) * 0.055;

        x += Math.cos(angle) * step;
        y += Math.sin(angle) * step;
        if (inside(x, y) || outsideScene(x, y)) break;
        pts.push([x, y]);

        if (k % 4 === 2) {
          leafSeeds.push({
            i: k,
            side: Math.floor(k / 4) % 2 === 0 ? 1 : -1,
            bend: 0.5 + rnd() * 0.5,
            size: (9 + rnd() * 14) * scale,
          });
        }
        if (k > 12 && rnd() < 0.035) {
          flowerSeeds.push({
            i: k,
            r: (12 + rnd() * 17) * scale,
            ci: Math.floor(rnd() * 997),
            ph: rnd() * TAU,
            rot: (rnd() - 0.5) * 0.8,
            species: pickSpecies(speciesRnd, this.theme, this.season),
          });
        }
        if (
          depth === 0 &&
          k > 32 &&
          k < steps - 24 &&
          rnd() < 0.05 &&
          branches.length < 1 &&
          this.vines.length + branches.length < totalLimit
        ) {
          const childLength = 26 + Math.floor(rnd() * 26);
          const childAngle = angle + (rnd() < 0.5 ? -1 : 1) * (0.65 + rnd() * 0.55);
          branches.push({
            startX: x,
            startY: y,
            targetX: x + Math.cos(childAngle) * childLength * step,
            targetY: y + Math.sin(childAngle) * childLength * step,
            maxSteps: childLength,
            width: width * (0.42 + rnd() * 0.18),
            delay: clamp(delay + (k / steps) * 0.36, 0, 0.7),
            depth: 1,
          });
        }
      }

      if (pts.length < 5) return null;
      const last = pts[pts.length - 1];
      flowerSeeds.push({
        i: pts.length - 1,
        r: (15 + rnd() * 18) * scale,
        ci: Math.floor(rnd() * 997),
        ph: rnd() * TAU,
        rot: (rnd() - 0.5) * 0.9,
        species: pickSpecies(speciesRnd, this.theme, this.season),
        tip: true,
      });

      const leaves = leafSeeds
        .filter((seed) => seed.i < pts.length - 1)
        .map((seed) => {
          const p = pts[seed.i];
          const next = pts[Math.min(seed.i + 1, pts.length - 1)];
          const tangent = Math.atan2(next[1] - p[1], next[0] - p[0]);
          return {
            i: seed.i,
            angle: tangent + seed.side * (0.6 + seed.bend),
            size: seed.size,
          };
        });

      return {
        pts,
        leaves,
        flowers: flowerSeeds,
        branches,
        delay,
        width,
        depth,
        phase: rnd() * TAU,
        tip: last,
      };
    };

    for (let i = 0; i < vineCount; i += 1) {
      const [startX, startY] = spawners[i % spawners.length]();
      const targetX = clock.x + clock.w * (0.08 + rnd() * 0.84);
      const targetY = clock.y + clock.h * (0.08 + rnd() * 0.84);
      const vine = generate({
        startX,
        startY,
        targetX,
        targetY,
        maxSteps: Math.round(190 - 40 * scale) + Math.floor(rnd() * 30),
        width: (2.1 + rnd() * 1.9) * scale,
        delay: rnd() * 0.3,
        depth: 0,
      });
      if (!vine) continue;
      this.vines.push(vine);
      for (const branch of vine.branches) {
        const child = generate(branch);
        if (child) this.vines.push(child);
      }
    }

    // Rose clusters sit left, right and bottom-right of the digits, as in the sketch.
    const minGap = 26 * scale;
    const leftX = clamp(clock.x - W * 0.055, W * 0.08, W * 0.28);
    const rightX = clamp(clock.x + clock.w + W * 0.055, W * 0.72, W * 0.92);
    const bottomX = clamp(clock.x + clock.w * 0.82, W * 0.56, W * 0.92);
    const spots = [
      { x: leftX, y: clamp(clock.y + clock.h * 0.68, H * 0.28, H * 0.78), side: -1 },
      { x: rightX, y: clamp(clock.y + clock.h * 0.25, H * 0.2, H * 0.68), side: 1 },
      {
        x: bottomX,
        y: clamp(clock.y + clock.h + minGap * 2, H * 0.6, H * 0.9),
        side: 0,
      },
    ];
    const spreadX = Math.min(W * 0.105, 135 * scale);
    const spreadY = Math.min(H * 0.1, 90 * scale);
    spots.forEach((spot, spotIndex) => {
      const count = Math.round((6 + rnd() * 4) * (W < 700 ? 0.8 : 1));
      const delay = 0.42 + spotIndex * 0.08 + rnd() * 0.12;
      for (let k = 0; k < count; k += 1) {
        let ox;
        let oy;
        if (spot.side === -1) {
          ox = -rnd() * spreadX * 1.2 + (rnd() - 0.5) * spreadX * 0.4;
          oy = (rnd() - 0.5) * spreadY;
        } else if (spot.side === 1) {
          ox = rnd() * spreadX * 1.1 + (rnd() - 0.5) * spreadX * 0.35;
          oy = (rnd() - 0.5) * spreadY;
        } else {
          ox = (rnd() - 0.5) * spreadX;
          oy = rnd() * spreadY * 0.7;
        }
        this.clusters.push({
          x: clamp(spot.x + ox, 22 * scale, W - 22 * scale),
          y: clamp(spot.y + oy, 22 * scale, H - 22 * scale),
          r: (13 + rnd() * 18) * scale,
          ci: Math.floor(rnd() * 997),
          ph: rnd() * TAU,
          rot: (rnd() - 0.5) * 1.1,
          delay: delay + rnd() * 0.18,
          species: pickSpecies(speciesRnd, this.theme, this.season, true),
        });
      }
      this.clusters.push({ kind: 'spot', x: spot.x, y: spot.y });
      for (let stemIndex = 0; stemIndex < 2; stemIndex += 1) {
        const stem = makeClusterStem(spot.x, spot.y, scale, rnd, delay + stemIndex * 0.04);
        this.vines.push(stem);
      }
    });
    this.clusters = this.clusters.filter((item) => item.kind !== 'spot');

    if (!this.reduced) {
      if (sameLayout) this.butterflies.push(...previous.visitors);
      const butterflyCount = W < 700 ? 1 : 2;
      for (let i = 0; i < butterflyCount; i += 1) {
        this.butterflies.push({
          baseX: W * (0.14 + rnd() * 0.72),
          baseY: H * (0.16 + rnd() * 0.58),
          ax: 38 + rnd() * 90,
          ay: 20 + rnd() * 54,
          speed: 0.16 + rnd() * 0.22,
          phase: rnd() * TAU,
          size: Math.max(8, (10 + rnd() * 5) * scale),
          variant: i,
        });
      }
    }

    this.restoreGrowth(Number(options.growth) || 0);
    this.buildMs = performance.now() - started;
  }

  restoreGrowth(count) {
    const target = Math.min(MAX_EXTRA_GROWTH, Math.max(0, Math.floor(Number(count) || 0)));
    while (this.extraGrowth < target) {
      const before = this.extraGrowth;
      this.growOne({ instant: true });
      if (this.extraGrowth === before) break;
    }
    return this.extraGrowth;
  }

  /**
   * Add one short vine at an edge without rebuilding the base garden. This is
   * the idle-growth primitive used by both live sessions and saved gardens.
   */
  growOne(options = {}) {
    if (this.extraGrowth >= MAX_EXTRA_GROWTH) return null;
    if (!this.W || !this.H) this.resize();
    this.extraGrowth += 1;
    const rnd = mulberry32((this.seed ^ Math.imul(this.extraGrowth, 0x9e3779b1)) >>> 0);
    const speciesRnd = mulberry32((this.seed ^ Math.imul(this.extraGrowth, 0x85ebca6b)) >>> 0);
    const { W, H, box: clock } = this;
    const scale = clamp(Math.min(W, H) / 900, 0.58, 1.35);
    const instant = !!options.instant || this.reduced;
    const bornAt = instant ? 0 : performance.now();
    const edge = Math.floor(rnd() * 4);
    let x;
    let y;
    let targetX;
    let targetY;
    if (edge === 0) {
      x = -12;
      y = H * (0.12 + rnd() * 0.76);
      targetX = W * (0.04 + rnd() * 0.22);
      targetY = H * (0.08 + rnd() * 0.84);
    } else if (edge === 1) {
      x = W + 12;
      y = H * (0.12 + rnd() * 0.76);
      targetX = W * (0.74 + rnd() * 0.22);
      targetY = H * (0.08 + rnd() * 0.84);
    } else if (edge === 2) {
      x = W * (0.08 + rnd() * 0.84);
      y = -12;
      targetX = W * (0.06 + rnd() * 0.88);
      targetY = H * (0.04 + rnd() * 0.26);
    } else {
      x = W * (0.08 + rnd() * 0.84);
      y = H + 12;
      targetX = W * (0.06 + rnd() * 0.88);
      targetY = H * (0.68 + rnd() * 0.28);
    }

    let angle = Math.atan2(targetY - y, targetX - x) + (rnd() - 0.5) * 0.7;
    let wobble = rnd() * TAU;
    const pts = [[x, y]];
    const leaves = [];
    const steps = 16 + Math.floor(rnd() * 18);
    const step = clamp(W / 170, 3.4, 6);
    for (let k = 0; k < steps; k += 1) {
      wobble += 0.13 + rnd() * 0.04;
      const desired = Math.atan2(targetY - y, targetX - x);
      const diff = Math.atan2(Math.sin(desired - angle), Math.cos(desired - angle));
      angle += diff * 0.055 + Math.sin(wobble) * 0.09 + (rnd() - 0.5) * 0.05;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      if (x < -W * 0.2 || x > W * 1.2 || y < -H * 0.2 || y > H * 1.2) break;
      // Keep at least a few points so every persisted growth produces a vine.
      if (
        pts.length > 3 &&
        clock &&
        x > clock.x &&
        x < clock.x + clock.w &&
        y > clock.y &&
        y < clock.y + clock.h
      ) {
        break;
      }
      pts.push([x, y]);
      if (k % 5 === 3) {
        leaves.push({
          i: k,
          angle: angle + (k % 10 < 5 ? 1 : -1) * (0.6 + rnd() * 0.45),
          size: (7 + rnd() * 11) * scale,
        });
      }
    }
    if (pts.length < 4) {
      this.extraGrowth -= 1;
      this.newestGrowthAt = 0;
      return null;
    }

    const flowerCount = rnd() < 0.34 ? 2 : 1;
    const flowers = [];
    for (let i = 0; i < flowerCount; i += 1) {
      flowers.push({
        i: i === 0 ? pts.length - 1 : Math.max(2, Math.floor(pts.length * (0.58 + rnd() * 0.2))),
        r: (13 + rnd() * 16) * scale,
        ci: Math.floor(rnd() * 997),
        ph: rnd() * TAU,
        rot: (rnd() - 0.5) * 0.9,
        species: pickSpecies(speciesRnd, this.theme, this.season),
        tip: i === 0,
      });
    }

    const vine = {
      pts,
      leaves,
      flowers,
      delay: 0,
      width: Math.max(0.8, (1.15 + rnd() * 0.8) * scale),
      depth: 1,
      phase: rnd() * TAU,
      clusterStem: true,
      bornAt,
      growMs: EXTRA_GROW_MS,
    };
    this.vines.push(vine);
    this.stemsCache = null;
    this.newestGrowthAt = bornAt;
    return vine;
  }

  vineLocal(vine, grown, timestamp) {
    if (vine.bornAt) {
      return easeOutCubic(clamp((timestamp - vine.bornAt) / (vine.growMs || EXTRA_GROW_MS), 0, 1));
    }
    return this.vineProgress(vine, grown);
  }

  /**
   * Bloom a single flower where the visitor clicked and send a butterfly to it.
   * The clock box is protected so a bloom never obscures the digits.
   */
  bloomAt(x, y, options = {}) {
    if (!this.W || !this.H) this.resize();
    const season = options.season || this.season;
    const scale = clamp(Math.min(this.W, this.H) / 900, 0.58, 1.35);
    let px = clamp(Number(x) || 0, 14, this.W - 14);
    let py = clamp(Number(y) || 0, 14, this.H - 14);
    const clock = this.box;
    if (clock && px > clock.x && px < clock.x + clock.w && py > clock.y && py < clock.y + clock.h) {
      py = clock.y + clock.h + 20 < this.H ? clock.y + clock.h + 20 : clamp(clock.y - 20, 14, this.H - 14);
    }
    const rnd = mulberry32(
      (this.seed ^ Math.imul(this.extras.length + 1, 0x85ebca6b) ^ Math.floor(performance.now())) >>> 0,
    );
    const flower = {
      x: px,
      y: py,
      r: (16 + rnd() * 11) * scale,
      rot: (rnd() - 0.5) * 1.1,
      ph: rnd() * TAU,
      ci: Math.floor(rnd() * 997),
      species: options.species || pickSpecies(rnd, this.theme, season),
      bornAt: this.reduced ? 0 : performance.now(),
      stem: (8 + rnd() * 10) * scale,
      stemBend: (rnd() - 0.5) * 0.7,
    };
    this.extras.push(flower);
    if (this.extras.length > 48) this.extras.shift();
    this.summonButterfly(px, py);
    return flower;
  }

  summonButterfly(x, y) {
    if (this.reduced || !this.W || !this.H) return null;
    const rnd = mulberry32(
      (this.seed ^ Math.imul(this.butterflies.length + 3, 0xc2b2ae35) ^ Math.floor(performance.now())) >>> 0,
    );
    const visitor = {
      baseX: clamp(x + (rnd() - 0.5) * 22, 20, this.W - 20),
      baseY: clamp(y - 14 + (rnd() - 0.5) * 16, 20, this.H - 20),
      ax: 16 + rnd() * 24,
      ay: 8 + rnd() * 14,
      speed: 0.45 + rnd() * 0.3,
      phase: rnd() * TAU,
      size: Math.max(8, (9 + rnd() * 4) * clamp(Math.min(this.W, this.H) / 900, 0.6, 1.25)),
      variant: Math.floor(rnd() * 4),
      fromX: x < this.W / 2 ? -24 : this.W + 24,
      fromY: clamp(y + (rnd() - 0.5) * 70, 20, this.H - 20),
      arriveAt: performance.now() + 1500 + rnd() * 500,
    };
    this.butterflies.push(visitor);
    if (this.butterflies.length > 8) {
      const index = this.butterflies.findIndex((item) => item.fromX != null);
      this.butterflies.splice(index >= 0 ? index : 0, 1);
    }
    return visitor;
  }

  vineProgress(vine, grown) {
    if (vine.delay >= 0.999) return grown >= 1 ? 1 : 0;
    return clamp((grown - vine.delay) / (1 - vine.delay), 0, 1);
  }

  draw(theme, timestamp) {
    if (!this.x || !this.vines.length) return;
    this.theme = theme;
    const { x, W, H } = this;
    x.clearRect(0, 0, W, H);

    const elapsed = timestamp - this.t0;
    const progress = this.reduced ? 1 : clamp(elapsed / GROW_MS, 0, 1);
    const grown = easeOutCubic(progress);
    const windAmp = this.reduced ? 0 : clamp(0.18 + this.wind / 45, 0.18, 1.25);
    const growingExtra = this.vines.some(
      (vine) => vine.bornAt && timestamp - vine.bornAt < (vine.growMs || EXTRA_GROW_MS),
    );

    if (progress >= 1 && !growingExtra) {
      if (!this.stemsCache) this.renderStemsCache(theme);
      if (this.stemsCache) x.drawImage(this.stemsCache, 0, 0, W, H);
    } else {
      for (const vine of this.vines) {
        this.drawStem(x, vine, theme, this.vineLocal(vine, grown, timestamp));
      }
    }

    for (const vine of this.vines) {
      this.drawLeaves(x, vine, theme, this.vineLocal(vine, grown, timestamp), timestamp, windAmp);
    }

    for (const vine of this.vines) {
      const local = this.vineLocal(vine, grown, timestamp);
      if (local <= 0) continue;
      const count = Math.max(2, Math.floor(local * vine.pts.length));
      for (const flower of vine.flowers) {
        if (flower.i >= count) continue;
        const bloom = clamp((count - flower.i) / 10, 0, 1);
        if (bloom <= 0) continue;
        const [px, py] = vine.pts[flower.i];
        const pulse = 1 + Math.sin(timestamp / 1400 + flower.ph) * 0.03 * (0.45 + windAmp);
        this.drawFlower(
          x,
          px,
          py,
          flower.r * pulse,
          flower.rot,
          theme,
          flower.ph,
          bloom,
          flower.ci,
          flower.species,
        );
      }
    }

    for (const flower of this.clusters) {
      const bloom = this.reduced ? 1 : clamp((grown - flower.delay) / 0.16, 0, 1);
      if (bloom <= 0) continue;
      const pulse = 1 + Math.sin(timestamp / 1400 + flower.ph) * 0.03 * (0.45 + windAmp);
      this.drawFlower(
        x,
        flower.x,
        flower.y,
        flower.r * pulse,
        flower.rot,
        theme,
        flower.ph,
        bloom,
        flower.ci,
        flower.species,
      );
    }

    for (const flower of this.extras) {
      const bloom = this.reduced || !flower.bornAt ? 1 : clamp((timestamp - flower.bornAt) / 900, 0, 1);
      const pulse = 1 + Math.sin(timestamp / 1300 + flower.ph) * 0.025 * (0.4 + windAmp);
      x.save();
      x.strokeStyle = theme.vine;
      x.globalAlpha = 0.7;
      x.lineWidth = Math.max(0.8, flower.r * 0.06);
      x.beginPath();
      x.moveTo(flower.x, flower.y + flower.stem * 1.7);
      x.quadraticCurveTo(
        flower.x + flower.stemBend * 12,
        flower.y + flower.stem * 0.7,
        flower.x,
        flower.y + flower.r * 0.25,
      );
      x.stroke();
      x.restore();
      this.drawFlower(
        x,
        flower.x,
        flower.y,
        flower.r * pulse,
        flower.rot,
        theme,
        flower.ph,
        bloom,
        flower.ci,
        flower.species,
      );
    }

    if (!this.reduced) {
      for (const butterfly of this.butterflies) {
        this.drawButterfly(x, butterfly, timestamp, theme, windAmp);
      }
    }

    // Build the stem-only cache after the first fully grown frame.
    if (progress >= 1 && !growingExtra && !this.stemsCache) this.renderStemsCache(theme);
  }

  drawStem(ctx, vine, theme, local) {
    if (local <= 0) return;
    const count = Math.max(2, Math.floor(local * vine.pts.length));
    const pts = vine.pts;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = theme.vine;
    if (theme.neon && !this.lowPower) {
      ctx.shadowColor = theme.vine;
      ctx.shadowBlur = 12;
    }
    const ranges = [
      [0, Math.ceil(count * 0.55), 1],
      [Math.max(0, Math.ceil(count * 0.55) - 1), Math.ceil(count * 0.84), 0.72],
      [Math.max(0, Math.ceil(count * 0.84) - 1), count, 0.45],
    ];
    for (const [from, to, taper] of ranges) {
      if (to <= from + 1) continue;
      ctx.lineWidth = Math.max(0.6, vine.width * taper);
      ctx.beginPath();
      ctx.moveTo(pts[from][0], pts[from][1]);
      for (let i = from + 1; i < to && i < pts.length; i += 1) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  renderStemsCache(theme) {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(this.W * this.dpr));
    canvas.height = Math.max(1, Math.round(this.H * this.dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const vine of this.vines) this.drawStem(ctx, vine, theme, 1);
    this.stemsCache = canvas;
  }

  drawLeaves(ctx, vine, theme, local, timestamp, windAmp) {
    if (local <= 0) return;
    const count = Math.max(2, Math.floor(local * vine.pts.length));
    ctx.save();
    ctx.fillStyle = theme.leaf;
    for (const leaf of vine.leaves) {
      if (leaf.i >= count - 1) continue;
      const [px, py] = vine.pts[leaf.i];
      const grow = clamp((count - leaf.i) / 8, 0, 1);
      if (grow <= 0) continue;
      const sway = Math.sin(timestamp / 900 + vine.phase + leaf.i * 0.7) * 0.1 * windAmp;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(leaf.angle + sway);
      const size = leaf.size * grow;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(size * 0.52, -size * 0.34, size, 0);
      ctx.quadraticCurveTo(size * 0.52, size * 0.34, 0, 0);
      ctx.fill();
      if (size > 11) {
        ctx.strokeStyle = theme.swirl;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = Math.max(0.5, size * 0.028);
        ctx.beginPath();
        ctx.moveTo(size * 0.12, 0);
        ctx.quadraticCurveTo(size * 0.54, -size * 0.08, size * 0.88, 0);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    ctx.restore();
  }

  drawFlower(ctx, px, py, radius, rotation, theme, phase, bloom, colorIndex, species) {
    if (radius < 0.8 || bloom <= 0) return;
    const scale = easeOutBack(bloom);
    const r = radius * scale;
    const color = theme.flowers[Math.abs(colorIndex) % theme.flowers.length];
    const kind = species || theme.bloom || 'rose';
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rotation + phase * 0.15);
    ctx.fillStyle = color;
    ctx.strokeStyle = theme.swirl;
    ctx.lineWidth = Math.max(0.8, r * 0.07);
    if (theme.neon && !this.lowPower) {
      ctx.shadowColor = color;
      ctx.shadowBlur = Math.min(16, r * 0.7);
    }

    const petal = (angle, distance, rx, ry, tilt = 0) => {
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(distance, 0, rx, ry, tilt, 0, TAU);
      ctx.fill();
      ctx.restore();
    };

    if (kind === 'daisy') {
      for (let i = 0; i < 9; i += 1) petal((TAU / 9) * i, r * 0.58, r * 0.44, r * 0.17);
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme.center || '#ffcf33';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.27, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80, 40, 0, .25)';
      ctx.lineWidth = Math.max(0.6, r * 0.035);
      for (let i = 0; i < 7; i += 1) {
        const a = (TAU / 7) * i;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.13, Math.sin(a) * r * 0.13, r * 0.025, 0, TAU);
        ctx.stroke();
      }
    } else if (kind === 'tulip') {
      for (let i = -1; i <= 1; i += 1) {
        ctx.save();
        ctx.rotate(i * 0.38);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.28, r * 0.31, r * 0.58, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme.center || '#ffd34d';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.16, r * 0.12, r * 0.24, 0, 0, TAU);
      ctx.fill();
    } else if (kind === 'cosmos') {
      for (let i = 0; i < 8; i += 1) {
        const angle = (TAU / 8) * i;
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(r * 0.56, 0, r * 0.5, r * 0.13, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme.center || '#ffd34d';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.19, 0, TAU);
      ctx.fill();
    } else if (kind === 'sunflower') {
      for (let i = 0; i < 16; i += 1) {
        const angle = (TAU / 16) * i;
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(r * 0.62, 0, r * 0.48, r * 0.14, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme.center || '#6b3f1d';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.34, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      for (let i = 0; i < 9; i += 1) {
        const a = (TAU / 9) * i;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, r * 0.025, 0, TAU);
        ctx.fill();
      }
    } else if (kind === 'lotus') {
      for (let i = 0; i < 7; i += 1) {
        const angle = (TAU / 7) * i;
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(r * 0.36, -r * 0.54, r * 0.9, 0);
        ctx.quadraticCurveTo(r * 0.36, r * 0.54, 0, 0);
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = theme.center || '#ffe6a7';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.22, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (kind === 'bell') {
      for (let i = -2; i <= 2; i += 1) {
        ctx.save();
        ctx.rotate(i * 0.3);
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.5);
        ctx.quadraticCurveTo(r * 0.38, -r * 0.2, r * 0.25, r * 0.52);
        ctx.quadraticCurveTo(0, r * 0.85, -r * 0.25, r * 0.52);
        ctx.quadraticCurveTo(-r * 0.38, -r * 0.2, 0, -r * 0.5);
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme.center || '#ffe6a7';
      ctx.beginPath();
      ctx.arc(0, r * 0.3, r * 0.12, 0, TAU);
      ctx.fill();
    } else if (kind === 'chrysanthemum') {
      for (let layer = 0; layer < 2; layer += 1) {
        const count = layer === 0 ? 18 : 11;
        const length = layer === 0 ? 0.9 : 0.58;
        for (let i = 0; i < count; i += 1) {
          const angle = (TAU / count) * i + layer * 0.16;
          ctx.save();
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.ellipse(r * length * 0.55, 0, r * length * 0.45, r * 0.1, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme.center || '#ffd34d';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.18, 0, TAU);
      ctx.fill();
    } else if (kind === 'camellia') {
      for (let layer = 0; layer < 2; layer += 1) {
        const count = layer === 0 ? 6 : 5;
        for (let i = 0; i < count; i += 1) {
          const angle = (TAU / count) * i + layer * 0.4;
          ctx.save();
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.ellipse(layer === 0 ? r * 0.42 : r * 0.24, 0, r * 0.42, r * 0.3, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme.center || '#ffe6a7';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.18, 0, TAU);
      ctx.fill();
    } else {
      // Lobed rose silhouette with the spiral seen in the reference art.
      ctx.beginPath();
      for (let a = 0; a <= TAU + 0.04; a += 0.12) {
        const rr = r * (1 + 0.14 * Math.sin(5 * a + phase));
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 4; a += 0.17) {
        const rr = r * 0.76 * (a / (Math.PI * 4));
        const x = Math.cos(a + phase) * rr;
        const y = Math.sin(a + phase) * rr;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.12, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawButterfly(ctx, butterfly, timestamp, theme, windAmp) {
    const t = timestamp / 1000;
    let x =
      butterfly.baseX +
      Math.sin(t * butterfly.speed + butterfly.phase) * butterfly.ax +
      Math.sin(t * butterfly.speed * 2.3 + butterfly.phase) * butterfly.ax * 0.16;
    let y =
      butterfly.baseY +
      Math.cos(t * butterfly.speed * 0.8 + butterfly.phase) * butterfly.ay +
      Math.sin(t * butterfly.speed * 1.9) * windAmp * 4;
    let angle = Math.cos(t * butterfly.speed + butterfly.phase) * 0.35;
    if (butterfly.fromX != null && timestamp < butterfly.arriveAt) {
      const start = butterfly.arriveAt - 1800;
      const progress = easeOutCubic(clamp((timestamp - start) / 1800, 0, 1));
      const fromY = butterfly.fromY ?? butterfly.baseY;
      const dx = butterfly.baseX - butterfly.fromX;
      const dy = butterfly.baseY - fromY;
      x = butterfly.fromX + dx * progress + Math.sin(progress * Math.PI) * 16;
      y = fromY + dy * progress - Math.sin(progress * Math.PI) * 22;
      angle = Math.atan2(dy, dx) * 0.35;
    }
    const flap = 0.22 + 0.78 * Math.abs(Math.sin(t * 8.5 + butterfly.phase));
    const wing = theme.flowers[butterfly.variant % theme.flowers.length];
    const wingAlt = theme.flowers[(butterfly.variant + 1) % theme.flowers.length];

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(butterfly.size, butterfly.size);
    ctx.globalAlpha = 0.9;
    if (theme.neon && !this.lowPower) {
      ctx.shadowColor = theme.vine;
      ctx.shadowBlur = 10;
    }
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side * flap, 1);
      ctx.fillStyle = wing;
      ctx.beginPath();
      ctx.ellipse(0.43, -0.4, 0.44, 0.28, -0.42, 0, TAU);
      ctx.fill();
      ctx.fillStyle = wingAlt;
      ctx.beginPath();
      ctx.ellipse(0.34, 0.28, 0.32, 0.2, 0.34, 0, TAU);
      ctx.fill();
      ctx.fillStyle = theme.swirl;
      ctx.beginPath();
      ctx.ellipse(0.28, -0.42, 0.11, 0.09, -0.2, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = theme.vine;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.075, 0.46, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = theme.vine;
    ctx.lineWidth = 0.045;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -0.4);
    ctx.quadraticCurveTo(-0.12, -0.65, -0.23, -0.78);
    ctx.moveTo(0, -0.4);
    ctx.quadraticCurveTo(0.12, -0.65, 0.23, -0.78);
    ctx.stroke();
    ctx.restore();
  }
}
