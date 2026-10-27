// Weather particle layer. One canvas above the garden, driven by wind and
// day/night, with a strict particle budget and a calm reduced-motion mode.

import { clamp, mulberry32, randomSeed } from './rand.js';

const COUNTS = { clear: 34, cloud: 7, fog: 6, rain: 230, storm: 340, snow: 150, stars: 140 };

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
    this.lowPower = !!options.lowPower;
    this.particles = [];
    this.flash = 0;
    this.nextBolt = 4;
    this.seed = options.seed ?? randomSeed();
    this.rnd = mulberry32(this.seed);
    this.lean = 0;
    this.stars = [];
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
    return { width: this.W, height: this.H };
  }

  setReduced(reduced) {
    this.reduced = !!reduced;
  }

  setLowPower(value) {
    this.lowPower = !!value;
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
    const quality = (this.lowPower ? 0.5 : 1) * (this.reduced ? 0.28 : 1);
    const { W, H } = this;
    const baseKind = this.kind === 'clear' && !this.day ? 'stars' : this.kind;
    const count = Math.round((COUNTS[baseKind] ?? 0) * quality);
    this.particles = [];

    if (baseKind === 'stars') {
      this.stars = Array.from({ length: count }, () => ({
        x: rnd() * W,
        y: rnd() * H * 0.88,
        r: 0.5 + rnd() * 1.7,
        phase: rnd() * Math.PI * 2,
        speed: 0.5 + rnd() * 1.4,
      }));
      return;
    }

    for (let i = 0; i < count; i += 1) {
      if (baseKind === 'rain' || baseKind === 'storm') {
        this.particles.push({
          x: rnd() * (W + 200) - 100,
          y: rnd() * H,
          z: 0.35 + rnd() * 0.95,
          speed: 520 + rnd() * 540,
          len: 10 + rnd() * 18,
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
    else if (this.kind === 'clear' && !this.day) this.drawNight(x, timestamp);

    if (this.kind === 'cloud') this.drawClouds(x, d, light, false);
    if (this.kind === 'fog') this.drawClouds(x, d, light, true);

    if (this.kind === 'rain' || this.kind === 'storm') {
      this.drawRain(x, d, light);
      if (this.kind === 'storm' && !this.reduced) this.drawLightning(x, d);
    }

    if (this.kind === 'snow') this.drawSnow(x, d, timestamp, light);
  }

  drawSunAndPollen(x, dt, timestamp, light) {
    const { W, H } = this;
    const warm = x.createRadialGradient(W * 0.84, H * 0.02, 0, W * 0.84, H * 0.02, H * 0.55);
    warm.addColorStop(0, light ? 'rgba(255, 218, 140, 0.28)' : 'rgba(255, 217, 138, 0.24)');
    warm.addColorStop(0.45, 'rgba(255, 208, 120, 0.07)');
    warm.addColorStop(1, 'rgba(255, 208, 120, 0)');
    x.fillStyle = warm;
    x.fillRect(0, 0, W, H);

    x.save();
    for (const p of this.particles) {
      p.x += dt * (p.speed + this.wind * 0.55) * p.z;
      p.y += Math.sin(timestamp / 1100 + p.phase) * 0.22 - dt * 1.3;
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

  drawNight(x, timestamp) {
    const { W, H } = this;
    const moon = x.createRadialGradient(W * 0.82, H * 0.14, 0, W * 0.82, H * 0.14, H * 0.22);
    moon.addColorStop(0, 'rgba(220, 235, 255, 0.15)');
    moon.addColorStop(1, 'rgba(220, 235, 255, 0)');
    x.fillStyle = moon;
    x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(236, 245, 255, 0.74)';
    x.beginPath();
    x.arc(W * 0.82, H * 0.14, Math.min(W, H) * 0.014, 0, Math.PI * 2);
    x.fill();

    for (const star of this.stars) {
      const alpha = 0.18 + 0.82 * Math.abs(Math.sin(timestamp / 1200 + star.phase));
      x.globalAlpha = alpha;
      x.fillStyle = star.r > 1.6 ? 'rgba(255, 222, 200, 0.95)' : '#ffffff';
      x.beginPath();
      x.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      x.fill();
      if (star.r > 1.9) {
        x.strokeStyle = 'rgba(255,255,255,.22)';
        x.lineWidth = 0.7;
        x.beginPath();
        x.moveTo(star.x - star.r * 3, star.y);
        x.lineTo(star.x + star.r * 3, star.y);
        x.moveTo(star.x, star.y - star.r * 3);
        x.lineTo(star.x, star.y + star.r * 3);
        x.stroke();
      }
    }
    x.globalAlpha = 1;
  }

  drawClouds(x, dt, light, fog) {
    const { W, H } = this;
    for (const p of this.particles) {
      p.x += dt * (p.speed + this.wind * 0.45) * p.z;
      if (p.x - p.r > W + 80) p.x = -p.r - 80;
      if (p.x + p.r < -100) p.x = W + p.r;
      const y = fog ? p.y : p.y % Math.max(1, H * 0.6) + 20;
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
  }

  drawRain(x, dt, light) {
    const { W, H } = this;
    const color =
      this.kind === 'storm'
        ? light
          ? 'rgba(50, 78, 112, .5)'
          : 'rgba(190, 218, 255, .62)'
        : light
          ? 'rgba(65, 100, 145, .4)'
          : 'rgba(165, 198, 240, .48)';
    const horizontal = this.lean * 10;
    x.strokeStyle = color;
    x.lineWidth = 1.1;
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
    }
    if (this.flash <= 0) return;
    x.fillStyle = `rgba(255,255,255,${this.flash * 0.32})`;
    x.fillRect(0, 0, W, H);
    // A cropped branch makes the flash read as lightning without strobing.
    const bx = W * (0.2 + this.rnd() * 0.6);
    x.strokeStyle = `rgba(255,255,255,${this.flash * 0.7})`;
    x.lineWidth = 1.4;
    x.beginPath();
    x.moveTo(bx, 0);
    for (let i = 1; i < 5; i += 1) {
      x.lineTo(bx + Math.sin(i * 2.2 + this.seed) * 28, (H * 0.12 * i) / 4);
    }
    x.stroke();
    this.flash -= dt / 0.33;
  }

  drawSnow(x, dt, timestamp, light) {
    const { W, H } = this;
    x.save();
    x.fillStyle = light ? 'rgba(255,255,255,.96)' : 'rgba(255,255,255,.88)';
    if (!this.lowPower) {
      x.shadowColor = light ? 'rgba(70, 110, 155, .5)' : 'rgba(160, 190, 230, .35)';
      x.shadowBlur = 4;
    }
    x.beginPath();
    for (const p of this.particles) {
      p.y += dt * p.speed * p.z;
      p.x += Math.sin(timestamp / 1000 + p.phase) * 0.5 + dt * this.lean * 3.2;
      if (p.y > H + 8) {
        p.y = -8;
        p.x = this.rnd() * W;
      }
      if (p.x > W + 8) p.x = -8;
      if (p.x < -8) p.x = W + 8;
      x.moveTo(p.x + p.r * p.z, p.y);
      x.arc(p.x, p.y, p.r * p.z, 0, Math.PI * 2);
    }
    x.fill();
    x.restore();
  }
}
