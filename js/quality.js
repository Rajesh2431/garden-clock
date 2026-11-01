// Device quality tiers. The app starts at a tier guessed from the hardware,
// then a frame-rate governor steps down if the device cannot keep up. It never
// steps back up during a session, so the picture does not flicker between
// tiers; a remembered downgrade expires after a week.

export const TIERS = ['high', 'medium', 'low'];

// Minimum milliseconds between redraws of each canvas. 0 = every frame.
// The sky changes slowly (twinkle and moon glow), so it is always throttled.
export const FRAME_BUDGET = {
  high: { garden: 0, sky: 1000 / 30, fx: 0 },
  medium: { garden: 1000 / 40, sky: 1000 / 20, fx: 1000 / 40 },
  low: { garden: 1000 / 24, sky: 1000 / 8, fx: 1000 / 30 },
};

// Flowers opened by one press of the Bloom button.
export const BURST_SIZE = { high: 7, medium: 6, low: 5 };

export const REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;

export function isTier(value) {
  return TIERS.includes(value);
}

/** The lower (cheaper) of two tiers. */
export function lowerTier(a, b) {
  if (!isTier(a)) return isTier(b) ? b : 'high';
  if (!isTier(b)) return a;
  return TIERS[Math.max(TIERS.indexOf(a), TIERS.indexOf(b))];
}

export function nextTier(tier) {
  const index = TIERS.indexOf(tier);
  return index >= 0 && index < TIERS.length - 1 ? TIERS[index + 1] : null;
}

/**
 * Guess a starting tier.
 * - `override` (from `?quality=`) wins when valid.
 * - 2 cores or 2 GB of memory → low.
 * - 4 cores, 4 GB, a touch-first device or Save-Data → medium (battery and heat).
 * - A fresh remembered downgrade is honoured.
 */
export function detectQuality(env = {}) {
  const { cores, memory, coarse, saveData, override, remembered, nowMs = Date.now() } = env;
  if (isTier(override)) return override;
  let tier = 'high';
  if ((cores && cores <= 2) || (memory && memory <= 2)) tier = 'low';
  else if ((cores && cores <= 4) || (memory && memory <= 4) || coarse || saveData) tier = 'medium';
  if (remembered && isTier(remembered.tier) && nowMs - Number(remembered.at || 0) < REMEMBER_MS) {
    tier = lowerTier(tier, remembered.tier);
  }
  return tier;
}

/**
 * Watches requestAnimationFrame timing. Call `sample(timestamp)` every frame;
 * it returns the new tier when the device should step down, otherwise null.
 */
export class FrameGovernor {
  constructor(options = {}) {
    this.tier = isTier(options.tier) ? options.tier : 'high';
    this.locked = !!options.locked;
    this.warmupMs = options.warmupMs ?? 6000;
    // Shorter settle time after a step, which only rebuilds the canvases.
    this.settleMs = options.settleMs ?? 2000;
    this.waitMs = this.warmupMs;
    this.windowMs = options.windowMs ?? 3000;
    this.strikesNeeded = options.strikes ?? 2;
    // Average rAF rate below which a tier is considered too heavy.
    this.thresholds = options.thresholds || { high: 40, medium: 24 };
    this.fps = 0;
    this.reset();
  }

  reset(timestamp = null) {
    this.startedAt = timestamp;
    this.last = timestamp;
    this.windowStart = null;
    this.frames = 0;
    this.strikes = 0;
  }

  sample(timestamp) {
    if (this.locked || !Number.isFinite(timestamp)) return null;
    if (this.startedAt === null) {
      this.reset(timestamp);
      return null;
    }
    const delta = timestamp - this.last;
    this.last = timestamp;
    // Only a really long gap (a hidden tab, a debugger, a sleeping laptop) is
    // ignored. Frames of a few hundred ms are exactly what an overloaded
    // device looks like, so they must count as slow.
    if (delta <= 0 || delta > 1500) {
      this.windowStart = null;
      this.frames = 0;
      return null;
    }
    if (timestamp - this.startedAt < this.waitMs) return null;
    if (this.windowStart === null) {
      this.windowStart = timestamp;
      this.frames = 0;
      return null;
    }
    this.frames += 1;
    const elapsed = timestamp - this.windowStart;
    if (elapsed < this.windowMs) return null;

    this.fps = (this.frames * 1000) / elapsed;
    this.windowStart = timestamp;
    this.frames = 0;
    const threshold = this.thresholds[this.tier];
    if (threshold === undefined || this.fps >= threshold) {
      this.strikes = 0;
      return null;
    }
    // Under half the target rate is unusable: step down after one window.
    this.strikes = this.fps < threshold / 2 ? this.strikesNeeded : this.strikes + 1;
    if (this.strikes < this.strikesNeeded) return null;
    const next = nextTier(this.tier);
    if (!next) return null;
    this.tier = next;
    this.reset(timestamp);
    this.waitMs = this.settleMs;
    return next;
  }
}
