// Weather particle layer. One canvas above the garden, driven by wind and
// day/night, with a strict particle budget and a calm reduced-motion mode.

import { clamp, mulberry32, randomSeed } from './rand.js';

// Share of the full particle/star budget per quality tier, and pixel-ratio caps.
const QUALITY = { high: 1, medium: 0.6, low: 0.35 };
const MAX_DPR = { high: 2, medium: 1.5, low: 1 };

// Clouds and fog are drawn at this fraction of the canvas size, then scaled up.
const HAZE_SCALE = 0.25;
// Pre-rendered snowflake: a disc of FLAKE_RADIUS with room for its glow.
const FLAKE_RADIUS = 4;
const FLAKE_SIZE = 24;

const COUNTS = { clear: 34, cloud: 7, fog: 6, drizzle: 90, rain: 230, storm: 340, snow: 150 };

export class FX {
  constructor(canvas, options = {}) {
    this.c = canvas;
    this.x = canvas?.getContext?.('2d') || null;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.kind = 'clear';
    this.day = true;
    this.wind = 0;
    this.theme = null;
    this.reduced = !!options.reducedMotion;
    this.quality = QUALITY[options.quality] ? options.quality : options.lowPower ? 'medium' : 'high';
    this.lowPower = this.quality !== 'high';
    this.particles = [];
    this.flash = 0;
    this.nextBolt = 4;
    this.boltX = 0.5;
    this.boltSeed = 0;
    this.seed = options.seed ?? randomSeed();
    this.rnd = mulberry32(this.seed);
    this.lean = 0;
  }

  resize() {
    const rect = this.c?.getBoundingClientRect?.() || { width: 800, height: 600 };
    this.W = Math.max(1, rect.width || 800);
    this.H = Math.max(1, rect.height || 600);
    const dpr = clamp(globalThis.devicePixelRatio || 1, 1, MAX_DPR[this.quality] || 2);
    this.dpr = dpr;
    const pixelWidth = Math.max(1, Math.round(this.W * dpr));
    const pixelHeight = Math.max(1, Math.round(this.H * dpr));
    if (this.c) {
      if (this.c.width !== pixelWidth) this.c.width = pixelWidth;
      if (this.c.height !== pixelHeight) this.c.height = pixelHeight;
    }
    if (this.x?.setTransform) this.x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: this.W, height: this.H };
  }

  setReduced(reduced) {
    this.reduced = !!reduced;
  }

  setLowPower(value) {
    this.setQuality(value ? 'medium' : 'high');
  }

  /** Switch quality tier. Call resize() afterwards so the pixel ratio applies. */
  setQuality(quality) {
    if (!QUALITY[quality]) return false;
    const changed = quality !== this.quality;
    this.quality = quality;
    this.lowPower = quality !== 'high';
    return changed;
  }

  set(kind, day, wind = 0, theme) {
    this.kind = kind || 'clear';
    this.day = !!day;
    this.wind = clamp(Number(wind) || 0, 0, 120);
    this.theme = theme || this.theme;
    this.lean = this.wind * 0.25;
    this.flash = 0;
    this.nextBolt = 3 + this.rnd() * 6;
    this.seed = (this.seed + Math.floor(this.rnd() * 1e6) + 1) >>> 0;
    const rnd = mulberry32(this.seed);
    const quality = QUALITY[this.quality] * (this.reduced ? 0.28 : 1);
    const { W, H } = this;
    const baseKind = this.kind;
    const count = baseKind === 'clear' && !this.day ? 0 : Math.round((COUNTS[baseKind] ?? 0) * quality);
    this.particles = [];

    for (let i = 0; i < count; i += 1) {
      if (baseKind === 'rain' || baseKind === 'storm' || baseKind === 'drizzle') {
        this.particles.push({
          x: rnd() * (W + 200) - 100,
          y: rnd() * H,
          z: 0.35 + rnd() * 0.95,
          speed: baseKind === 'drizzle' ? 260 + rnd() * 220 : 520 + rnd() * 540,
          len: baseKind === 'drizzle' ? 5 + rnd() * 8 : 10 + rnd() * 18,
        });
      } else if (baseKind === 'snow') {
        this.particles.push({
          x: rnd() * W,
          y: rnd() * H,
          z: 0.35 + rnd() * 1,
          speed: 28 + rnd() * 55,
          phase: rnd() * Math.PI * 2,
          r: 1 + rnd() * 2.8,
        });
      } else if (baseKind === 'cloud' || baseKind === 'fog') {
        this.particles.push({
          x: rnd() * (W + 300) - 150,
          y: baseKind === 'fog' ? H * 0.25 + rnd() * H * 0.65 : rnd() * H * 0.55,
          r: baseKind === 'fog' ? 180 + rnd() * 260 : 110 + rnd() * 190,
          speed: 3 + rnd() * 9,
          z: 0.5 + rnd(),
        });
      } else {
        // clear-day pollen
        this.particles.push({
          x: rnd() * W,
          y: rnd() * H,
          z: 0.3 + rnd() * 1,
          speed: 6 + rnd() * 12,
          phase: rnd() * Math.PI * 2,
          r: 0.7 + rnd() * 1.9,
        });
      }
    }
  }

  draw(dt, timestamp, theme) {
    if (!this.x) return;
    this.theme = theme || this.theme;
    const { x, W, H } = this;
    const light = !!this.theme?.light;
    const d = clamp(dt, 0, 0.08) * (this.reduced ? 0.3 : 1);
    x.clearRect(0, 0, W, H);

    if (this.kind === 'clear' && this.day) this.drawSunAndPollen(x, d, timestamp, light);

    if (this.kind === 'cloud') this.drawClouds(x, d, light, false);
    if (this.kind === 'fog') this.drawClouds(x, d, light, true);

    if (this.kind === 'rain' || this.kind === 'storm' || this.kind === 'drizzle') {
      this.drawRain(x, d, light);
      if (this.kind === 'storm' && !this.reduced) this.drawLightning(x, d);
    }

    if (this.kind === 'snow') this.drawSnow(x, d, timestamp, light);
  }

  drawSunAndPollen(x, dt, timestamp, light) {
    // The sky layer owns the sun disc; this layer only carries daylight pollen.
    const { W, H } = this;
    x.save();
    for (const p of this.particles) {
      p.x += dt * (p.speed + this.wind * 0.55) * p.z;
      // The sway is tuned per 60 fps frame; scale by dt so slower tiers match.
      p.y += Math.sin(timestamp / 1100 + p.phase) * 0.22 * dt * 60 - dt * 1.3;
      if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10;
      const alpha = 0.2 + 0.45 * Math.abs(Math.sin(timestamp / 1600 + p.phase));
      x.fillStyle = light ? `rgba(255, 196, 82, ${alpha})` : `rgba(255, 226, 168, ${alpha})`;
      x.beginPath();
      x.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  /**
   * Clouds and fog are soft radial gradients hundreds of pixels wide. Filling
   * them at full resolution every frame is the most expensive thing this layer
   * does, so they are drawn into a quarter-resolution buffer and scaled up;
   * the gradients are smooth enough that the upscale is invisible.
   */
  hazeTarget() {
    if (typeof document === 'undefined') return null;
    const width = Math.max(1, Math.ceil(this.W * HAZE_SCALE));
    const height = Math.max(1, Math.ceil(this.H * HAZE_SCALE));
    if (!this.haze) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext?.('2d');
      if (!ctx) return null;
      this.haze = { canvas, ctx };
    }
    const { canvas, ctx } = this.haze;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(HAZE_SCALE, 0, 0, HAZE_SCALE, 0, 0);
    return ctx;
  }

  drawClouds(main, dt, light, fog) {
    const { W, H } = this;
    const buffer = this.hazeTarget();
    const x = buffer || main;
    for (const p of this.particles) {
      p.x += dt * (p.speed + this.wind * 0.45) * p.z;
      if (p.x - p.r > W + 80) p.x = -p.r - 80;
      if (p.x + p.r < -100) p.x = W + p.r;
      const y = fog ? p.y : (p.y % Math.max(1, H * 0.6)) + 20;
      const alpha = fog ? (light ? 0.34 : 0.2) : light ? 0.38 : 0.24;
      const gradient = x.createRadialGradient(p.x, y, 0, p.x, y, p.r);
      gradient.addColorStop(
        0,
        fog
          ? light
            ? `rgba(255,255,255,${alpha})`
            : `rgba(205,216,232,${alpha})`
          : light
            ? `rgba(255,255,255,${alpha})`
            : `rgba(165,180,210,${alpha})`,
      );
      gradient.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.35})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gradient;
      x.fillRect(p.x - p.r, y - p.r, p.r * 2, p.r * 2);
    }
    if (buffer) main.drawImage(this.haze.canvas, 0, 0, W, H);
  }

  /** One pre-rendered glowing flake, stamped per particle instead of a blurred path. */
  flakeSprite(light) {
    if (typeof document === 'undefined') return null;
    const key = `${light ? 'light' : 'dark'}:${this.dpr}`;
    if (this.flake?.key === key) return this.flake;
    const canvas = document.createElement('canvas');
    const size = Math.ceil(FLAKE_SIZE * this.dpr);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return null;
    const scale = size / FLAKE_SIZE;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = light ? 'rgba(255,255,255,.96)' : 'rgba(255,255,255,.88)';
    ctx.shadowColor = light ? 'rgba(70, 110, 155, .5)' : 'rgba(160, 190, 230, .35)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(FLAKE_SIZE / 2, FLAKE_SIZE / 2, FLAKE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    this.flake = { key, canvas };
    return this.flake;
  }

  drawRain(x, dt, light) {
    const { W, H } = this;
    const drizzle = this.kind === 'drizzle';
    const color =
      this.kind === 'storm'
        ? light
          ? 'rgba(50, 78, 112, .5)'
          : 'rgba(190, 218, 255, .62)'
        : drizzle
          ? light
            ? 'rgba(65, 100, 145, .26)'
            : 'rgba(180, 208, 245, .32)'
          : light
            ? 'rgba(65, 100, 145, .4)'
            : 'rgba(165, 198, 240, .48)';
    const horizontal = this.lean * 10;
    x.strokeStyle = color;
    x.lineWidth = drizzle ? 0.75 : 1.1;
    x.beginPath();
    for (const p of this.particles) {
      const length = p.len * p.z;
      x.moveTo(p.x, p.y);
      x.lineTo(p.x + horizontal * 0.07 + length * 0.1, p.y + length);
      p.y += dt * p.speed;
      p.x += dt * horizontal;
      if (p.y > H + 24) {
        p.y = -20 - this.rnd() * 80;
        p.x = this.rnd() * (W + 160) - 80;
      }
      if (p.x > W + 30) p.x = -30;
    }
    x.stroke();
  }

  drawLightning(x, dt) {
    const { W, H } = this;
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.flash = 1;
      this.nextBolt = 3 + this.rnd() * 6;
      // Pick the bolt position once per strike; re-rolling it every frame made
      // the branch jump around the screen while the flash faded.
      this.boltX = 0.2 + this.rnd() * 0.6;
      this.boltSeed = this.rnd() * 100;
    }
    if (this.flash <= 0) return;
    x.fillStyle = `rgba(255,255,255,${this.flash * 0.32})`;
    x.fillRect(0, 0, W, H);
    // A cropped branch makes the flash read as lightning without strobing.
    const bx = W * this.boltX;
    x.strokeStyle = `rgba(255,255,255,${this.flash * 0.7})`;
    x.lineWidth = 1.4;
    x.beginPath();
    x.moveTo(bx, 0);
    for (let i = 1; i < 5; i += 1) {
      x.lineTo(bx + Math.sin(i * 2.2 + this.boltSeed) * 28, (H * 0.12 * i) / 4);
    }
    x.stroke();
    this.flash -= dt / 0.33;
  }

  drawSnow(x, dt, timestamp, light) {
    const { W, H } = this;
    // The glow only shows on the high tier; a blurred shadow on a path of a
    // few hundred circles is costly, so high stamps a pre-rendered flake.
    const sprite = this.lowPower ? null : this.flakeSprite(light);
    x.save();
    x.fillStyle = light ? 'rgba(255,255,255,.96)' : 'rgba(255,255,255,.88)';
    x.beginPath();
    for (const p of this.particles) {
      p.y += dt * p.speed * p.z;
      p.x += Math.sin(timestamp / 1000 + p.phase) * 0.5 * dt * 60 + dt * this.lean * 3.2;
      if (p.y > H + 8) {
        p.y = -8;
        p.x = this.rnd() * W;
      }
      if (p.x > W + 8) p.x = -8;
      if (p.x < -8) p.x = W + 8;
      const r = p.r * p.z;
      if (sprite) {
        const half = (r * FLAKE_SIZE) / (FLAKE_RADIUS * 2);
        x.drawImage(sprite.canvas, p.x - half, p.y - half, half * 2, half * 2);
      } else {
        x.moveTo(p.x + r, p.y);
        x.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
    }
    if (!sprite) x.fill();
    x.restore();
  }
}
