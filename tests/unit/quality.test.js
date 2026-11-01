import { describe, expect, it } from 'vitest';
import {
  BURST_SIZE,
  FRAME_BUDGET,
  FrameGovernor,
  REMEMBER_MS,
  TIERS,
  detectQuality,
  lowerTier,
  nextTier,
} from '../../js/quality.js';

describe('tier helpers', () => {
  it('orders tiers from most to least expensive', () => {
    expect(TIERS).toEqual(['high', 'medium', 'low']);
    expect(lowerTier('high', 'medium')).toBe('medium');
    expect(lowerTier('low', 'high')).toBe('low');
    expect(lowerTier('bogus', 'medium')).toBe('medium');
    expect(nextTier('high')).toBe('medium');
    expect(nextTier('low')).toBeNull();
  });

  it('defines a frame budget and burst size for every tier', () => {
    for (const tier of TIERS) {
      expect(FRAME_BUDGET[tier]).toBeDefined();
      expect(BURST_SIZE[tier]).toBeGreaterThan(0);
    }
  });
});

describe('detectQuality', () => {
  it('uses the hardware to pick a starting tier', () => {
    expect(detectQuality({ cores: 12, memory: 16 })).toBe('high');
    expect(detectQuality({ cores: 4, memory: 8 })).toBe('medium');
    expect(detectQuality({ cores: 8, memory: 8, coarse: true })).toBe('medium');
    expect(detectQuality({ cores: 8, saveData: true })).toBe('medium');
    expect(detectQuality({ cores: 2, memory: 8 })).toBe('low');
    expect(detectQuality({ cores: 8, memory: 2 })).toBe('low');
    expect(detectQuality({})).toBe('high');
  });

  it('honours a valid override and ignores an invalid one', () => {
    expect(detectQuality({ cores: 2, override: 'high' })).toBe('high');
    expect(detectQuality({ cores: 12, override: 'nope' })).toBe('high');
  });

  it('applies a remembered downgrade until it expires', () => {
    const nowMs = 10 * REMEMBER_MS;
    const fresh = { tier: 'low', at: nowMs - 1000 };
    const stale = { tier: 'low', at: nowMs - REMEMBER_MS - 1 };
    expect(detectQuality({ cores: 12, remembered: fresh, nowMs })).toBe('low');
    expect(detectQuality({ cores: 12, remembered: stale, nowMs })).toBe('high');
    // A remembered tier never raises the detected one.
    expect(detectQuality({ cores: 2, remembered: { tier: 'high', at: nowMs }, nowMs })).toBe('low');
  });
});

function run(governor, { from = 0, ms, fps }) {
  const step = 1000 / fps;
  let changed = null;
  let t = from;
  for (; t < from + ms; t += step) {
    const result = governor.sample(t);
    if (result) changed = result;
  }
  return { changed, t };
}

describe('FrameGovernor', () => {
  it('keeps a smooth device on its tier', () => {
    const governor = new FrameGovernor({ tier: 'high' });
    expect(run(governor, { ms: 30_000, fps: 60 }).changed).toBeNull();
    expect(governor.tier).toBe('high');
  });

  it('steps down after two slow windows, then again if still slow', () => {
    const governor = new FrameGovernor({ tier: 'high' });
    const first = run(governor, { ms: 20_000, fps: 30 });
    expect(first.changed).toBe('medium');
    const second = run(governor, { from: first.t, ms: 20_000, fps: 20 });
    expect(second.changed).toBe('low');
    expect(run(governor, { from: second.t, ms: 20_000, fps: 10 }).changed).toBeNull();
  });

  it('ignores the warm-up period and long pauses', () => {
    const governor = new FrameGovernor({ tier: 'high', warmupMs: 6000 });
    expect(run(governor, { ms: 5900, fps: 15 }).changed).toBeNull();
    // Hidden-tab style gaps (> 1.5 s) never count as slow frames.
    for (let t = 6000; t < 60_000; t += 2000) expect(governor.sample(t)).toBeNull();
  });

  it('steps a badly overloaded device all the way down quickly', () => {
    const governor = new FrameGovernor({ tier: 'high' });
    // Warm-up 6 s + one 3 s window → medium; settle 2 s + one window → low.
    const first = run(governor, { ms: 9_700, fps: 3 });
    expect(first.changed).toBe('medium');
    expect(run(governor, { from: first.t, ms: 5_700, fps: 3 }).changed).toBe('low');
  });

  it('never changes a locked tier', () => {
    const governor = new FrameGovernor({ tier: 'high', locked: true });
    expect(run(governor, { ms: 30_000, fps: 10 }).changed).toBeNull();
  });
});
