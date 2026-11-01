// Celestial background: a deterministic star field, the date's zodiac
// constellation and the moon phase. It sits behind the garden so vines and
// flowers remain the foreground layer.

import { clamp, mulberry32 } from './rand.js';
import { constellationForDate, dateKey, hashString, moonInfo, PHASES } from './almanac.js';

// Share of the full particle/star budget per quality tier, and pixel-ratio caps.
const QUALITY = { high: 1, medium: 0.75, low: 0.5 };
const MAX_DPR = { high: 2, medium: 1.5, low: 1 };

const TAU = Math.PI * 2;

export class Sky {
  constructor(canvas, options = {}) {
    this.c = canvas;
    this.x = canvas?.getContext?.('2d') || null;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.phase = 'night';
    this.kind = 'clear';
    this.theme = null;
    this.date = new Date();
    this.instant = this.date;
    this.latitude = 0;
    this.longitude = 0;
    this.season = 'spring';
    this.reduced = !!options.reducedMotion;
    this.quality = QUALITY[options.quality] ? options.quality : options.lowPower ? 'medium' : 'high';
    this.lowPower = this.quality !== 'high';
    this.stars = [];
    this.constellation = null;
    this.key = '';
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
    // Star positions are normalized to the old canvas size, so make the next
    // draw rebuild them even if the weather and date did not change.
    this.key = '';
    this.stars = [];
    this.constellation = null;
    return { width: this.W, height: this.H };
  }

  setReduced(value) {
    this.reduced = !!value;
    this.key = '';
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
    this.key = '';
    this.stars = [];
    this.constellation = null;
    return changed;
  }

  set(options = {}) {
    const date = options.date instanceof Date ? options.date : new Date();
    const phase = PHASES[options.phase] ? options.phase : this.phase;
    const kind = options.kind || this.kind;
    const latitude = Number(options.latitude) || 0;
    const longitude = Number(options.longitude) || 0;
    const season = options.season || this.season;
    const key = [
      dateKey(date),
      phase,
      kind,
      latitude.toFixed(2),
      longitude.toFixed(2),
      season,
      this.quality,
      this.reduced ? 'calm' : 'live',
    ].join('|');
    this.phase = phase;
    this.kind = kind;
    this.theme = options.theme || this.theme;
    this.date = date;
    // `date` may be a wall-clock date (UTC fields = local calendar). The moon
    // needs the real instant, so callers can pass it separately.
    this.instant = options.instant instanceof Date ? options.instant : date;
    this.latitude = latitude;
    this.longitude = longitude;
    this.season = season;
    if (key === this.key && this.stars.length) return false;
    this.key = key;
    this.build();
    return true;
  }

  build() {
    const { W, H } = this;
    const quality = QUALITY[this.quality] * (this.reduced ? 0.72 : 1);
    const count = Math.max(18, Math.round(132 * quality));
    const rnd = mulberry32(
      hashString(`${dateKey(this.date)}:${this.latitude.toFixed(1)}:${this.phase}:${this.season}`),
    );
    this.stars = Array.from({ length: count }, () => ({
      x: rnd() * W,
      y: rnd() * H * 0.78,
      r: 0.45 + rnd() * 1.65,
      phase: rnd() * TAU,
      speed: 0.35 + rnd() * 1.1,
      warm: rnd() > 0.82,
    }));
    this.constellation = constellationForDate(this.date);
  }

  draw(timestamp) {
    if (!this.x) return;
    const { x, W, H } = this;
    if (!this.stars.length) this.build();
    // Reduced motion freezes twinkle and pulses, so an unchanged sky needs no
    // redraw at all.
    const drawKey = this.reduced ? `${this.key}|${this.theme?.name || ''}|${W}x${H}` : null;
    if (drawKey && drawKey === this.drawnKey) return;
    this.drawnKey = drawKey;
    x.clearRect(0, 0, W, H);

    const visibility = this.visibility();
    const showSun = this.phase === 'morning' || this.phase === 'afternoon' || this.phase === 'evening';
    const showNight = this.phase === 'evening' || this.phase === 'night';
    if (showSun && (this.kind === 'clear' || this.kind === 'cloud')) {
      this.drawSun(x, this.phase, this.kind === 'cloud' ? 0.55 : 1);
    }
    if (showNight && visibility > 0.02) {
      this.drawStars(x, timestamp, visibility);
      this.drawConstellation(x, timestamp, visibility);
      this.drawMoon(x, timestamp, visibility);
    }
  }

  visibility() {
    switch (this.kind) {
      case 'clear':
        return 1;
      case 'cloud':
        return 0.48;
      case 'snow':
        return 0.24;
      case 'drizzle':
      case 'rain':
        return 0.14;
      case 'storm':
        return 0.07;
      case 'fog':
        return 0.08;
      default:
        return 0.7;
    }
  }

  drawSun(ctx, phase, strength) {
    const { W, H } = this;
    const positions = {
      // Keep the morning sun clear of the weather card in the top-left.
      morning: [0.68, 0.28, 0.044],
      afternoon: [0.82, 0.14, 0.035],
      evening: [0.78, 0.67, 0.032],
    };
    const [px, py, size] = positions[phase] || positions.afternoon;
    const cx = W * px;
    const cy = H * py;
    const r = Math.min(W, H) * size;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 6.5);
    glow.addColorStop(0, `rgba(255, 226, 146, ${0.32 * strength})`);
    glow.addColorStop(0.45, `rgba(255, 198, 112, ${0.1 * strength})`);
    glow.addColorStop(1, 'rgba(255, 190, 100, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r * 7, cy - r * 7, r * 14, r * 14);
    ctx.fillStyle = `rgba(255, 234, 170, ${0.92 * strength})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 255, 240, ${0.36 * strength})`;
    ctx.lineWidth = Math.max(0.7, r * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.22, 0, TAU);
    ctx.stroke();
  }

  drawStars(ctx, timestamp, visibility) {
    const light = !!this.theme?.light;
    const alphaBase = this.phase === 'evening' ? 0.46 : 0.82;
    for (const star of this.stars) {
      const twinkle = this.reduced ? 0.8 : 0.48 + 0.52 * Math.abs(Math.sin(timestamp / 1250 + star.phase));
      ctx.globalAlpha = alphaBase * visibility * twinkle;
      ctx.fillStyle = star.warm ? 'rgba(255, 225, 198, 0.95)' : light ? '#284667' : '#ffffff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r * (this.phase === 'evening' ? 0.8 : 1), 0, TAU);
      ctx.fill();
      if (star.r > 1.9) {
        ctx.strokeStyle = light ? 'rgba(30, 60, 95, .28)' : 'rgba(255,255,255,.25)';
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.moveTo(star.x - star.r * 3, star.y);
        ctx.lineTo(star.x + star.r * 3, star.y);
        ctx.moveTo(star.x, star.y - star.r * 3);
        ctx.lineTo(star.x, star.y + star.r * 3);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawConstellation(ctx, timestamp, visibility) {
    const { W, H, constellation } = this;
    if (!constellation) return;
    const width = Math.min(W * 0.25, 330);
    const height = width * 0.58;
    const left = W * 0.55;
    const top = H * 0.085;
    const light = !!this.theme?.light;
    const alpha = (this.phase === 'evening' ? 0.52 : 0.9) * visibility;
    const point = (star) => [left + star.x * width, top + star.y * height];

    ctx.save();
    ctx.strokeStyle = light ? `rgba(34, 65, 100, ${alpha * 0.38})` : `rgba(190, 220, 255, ${alpha * 0.34})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const [from, to] of constellation.lines) {
      const a = constellation.stars[from];
      const b = constellation.stars[to];
      if (!a || !b) continue;
      const [x1, y1] = point(a);
      const [x2, y2] = point(b);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();

    for (const star of constellation.stars) {
      const [x, y] = point(star);
      const special = star.name === constellation.special?.name;
      ctx.fillStyle = special
        ? light
          ? `rgba(241, 174, 76, ${alpha})`
          : `rgba(255, 224, 154, ${alpha})`
        : light
          ? `rgba(34, 65, 100, ${alpha * 0.8})`
          : `rgba(255, 255, 255, ${alpha * 0.8})`;
      ctx.beginPath();
      ctx.arc(x, y, special ? 3.1 : 1.65, 0, TAU);
      ctx.fill();
      if (special) {
        const pulse = this.reduced ? 1 : 1 + Math.sin(timestamp / 900) * 0.18;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, 6.5 * pulse, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 10 * pulse, y);
        ctx.lineTo(x - 5 * pulse, y);
        ctx.moveTo(x + 5 * pulse, y);
        ctx.lineTo(x + 10 * pulse, y);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = light ? 'rgba(26, 55, 88, .72)' : 'rgba(226, 240, 255, .68)';
    ctx.font = '500 9px Outfit, system-ui, sans-serif';
    ctx.letterSpacing = '0.14em';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `${constellation.name.toUpperCase()} · ${constellation.special?.name || ''}`.trim(),
      left,
      top + height + 12,
    );
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawMoon(ctx, timestamp, visibility) {
    const { W, H } = this;
    const r = Math.min(W, H) * (W < 700 ? 0.028 : 0.022);
    const x = W * 0.86;
    const y = H * (this.phase === 'evening' ? 0.28 : 0.14);
    const info = moonInfo(this.instant || this.date);
    const alpha = (this.phase === 'evening' ? 0.58 : 0.92) * visibility;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
    glow.addColorStop(0, `rgba(214, 230, 255, ${0.24 * alpha})`);
    glow.addColorStop(0.4, `rgba(190, 215, 255, ${0.08 * alpha})`);
    glow.addColorStop(1, 'rgba(190, 215, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = `rgba(238, 245, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();

    // Cut a moving shadow out of the lit disc to show the current phase.
    const offset = (1 - Math.abs(2 * info.phase - 1)) * r * 2;
    const direction = info.phase < 0.5 ? -1 : 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    ctx.beginPath();
    ctx.arc(x + offset * direction, y, r * 1.02, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    ctx.strokeStyle = `rgba(220, 235, 255, ${alpha * 0.32})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.3, 0, TAU);
    ctx.stroke();

    if (this.phase === 'night') {
      ctx.globalAlpha = alpha * 0.75;
      ctx.fillStyle = this.theme?.light ? 'rgba(26, 55, 88, .72)' : 'rgba(226, 240, 255, .68)';
      ctx.font = '500 9px Outfit, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(info.name.toUpperCase(), x, y + r * 1.8);
      ctx.globalAlpha = 1;
    }
    if (!this.reduced && visibility > 0.5) {
      const pulse = 0.45 + 0.2 * Math.sin(timestamp / 2400);
      ctx.globalAlpha = alpha * pulse;
      ctx.fillStyle = '#dfeeff';
      ctx.beginPath();
      ctx.arc(x + r * 0.35, y - r * 0.28, Math.max(0.7, r * 0.09), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}
