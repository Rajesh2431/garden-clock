import { describe, expect, it } from 'vitest';
import { clamp, easeOutBack, easeOutCubic, mulberry32, randomSeed } from '../../js/rand.js';

describe('mulberry32', () => {
  it('returns the same sequence for the same seed', () => {
    const first = mulberry32(42);
    const second = mulberry32(42);
    for (let index = 0; index < 20; index += 1) {
      expect(first()).toBe(second());
    }
  });

  it('stays inside the unit interval', () => {
    const random = mulberry32(1234);
    for (let index = 0; index < 500; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('diverges for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('math helpers', () => {
  it('clamps values to the given range', () => {
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(2, 0, 1)).toBe(1);
  });

  it('eases out cubic from zero to one', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBe(0.875);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it('overshoots slightly with easeOutBack', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 10);
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
  });

  it('creates a non-zero random seed', () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThan(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
