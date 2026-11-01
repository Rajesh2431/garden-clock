import { describe, expect, it } from 'vitest';
import {
  CONSTELLATIONS,
  PHASES,
  PHASE_KEYS,
  SEASONS,
  SEASON_KEYS,
  constellationForDate,
  dateKey,
  dayOfYear,
  hashString,
  moonInfo,
  resolveSeason,
  seasonForDate,
  seasonInfo,
  starOfDay,
  timePhase,
} from '../../js/almanac.js';

const utc = (year, month, day, hour = 12) => new Date(Date.UTC(year, month - 1, day, hour));

describe('Time phases', () => {
  it('exposes four ordered phases', () => {
    expect(PHASE_KEYS).toEqual(['morning', 'afternoon', 'evening', 'night']);
    expect(PHASES.morning.order).toBeLessThan(PHASES.afternoon.order);
  });

  it.each([
    [5, 0, 'morning'],
    [11, 59, 'morning'],
    [12, 0, 'afternoon'],
    [16, 59, 'afternoon'],
    [17, 0, 'evening'],
    [20, 59, 'evening'],
    [21, 0, 'night'],
    [4, 59, 'night'],
    [0, 0, 'night'],
    [24, 0, 'night'],
    [-1, 0, 'night'],
  ])('maps %i:%i to %s', (hour, minute, expected) => {
    expect(timePhase(hour, minute)).toBe(expected);
  });

  it('copes with invalid and overflowing minutes', () => {
    expect(timePhase('nope')).toBe('night');
    expect(timePhase(12, 60)).toBe('afternoon');
  });
});

describe('Seasons', () => {
  it('exposes spring, summer, autumn and winter', () => {
    expect(SEASON_KEYS).toEqual(['spring', 'summer', 'autumn', 'winter']);
    expect(seasonInfo('missing')).toBe(SEASONS.spring);
  });

  it('resolves northern seasons from the calendar', () => {
    expect(seasonForDate(utc(2026, 3, 1), 51.5)).toBe('spring');
    expect(seasonForDate(utc(2026, 6, 1), 51.5)).toBe('summer');
    expect(seasonForDate(utc(2026, 9, 1), 51.5)).toBe('autumn');
    expect(seasonForDate(utc(2026, 12, 1), 51.5)).toBe('winter');
  });

  it('flips the seasons below the equator', () => {
    expect(seasonForDate(utc(2026, 3, 1), -33.9)).toBe('autumn');
    expect(seasonForDate(utc(2026, 6, 1), -33.9)).toBe('winter');
    expect(seasonForDate(utc(2026, 9, 1), -33.9)).toBe('spring');
    expect(seasonForDate(utc(2026, 12, 1), -33.9)).toBe('summer');
  });

  it('honours a manual season on either hemisphere', () => {
    expect(resolveSeason('summer', utc(2026, 12, 1), -33.9)).toBe('summer');
    expect(resolveSeason('auto', utc(2026, 12, 1), -33.9)).toBe('summer');
    expect(resolveSeason('spring', utc(2026, 12, 1), 51.5)).toBe('spring');
  });
});

describe('Moon phases', () => {
  it('starts at a new moon at the epoch', () => {
    const info = moonInfo(new Date(Date.UTC(2000, 0, 6, 18, 14)));
    expect(info.phase).toBeCloseTo(0, 5);
    expect(info.illumination).toBeCloseTo(0, 5);
    expect(info.name).toBe('New moon');
  });

  it('reaches full moon half a synodic month later', () => {
    const halfMonth = 29.530588853 / 2;
    const info = moonInfo(new Date(Date.UTC(2000, 0, 6, 18, 14) + halfMonth * 86_400_000));
    expect(info.phase).toBeCloseTo(0.5, 4);
    expect(info.illumination).toBeCloseTo(1, 4);
    expect(info.name).toBe('Full moon');
  });

  it('returns a phase and illumination for any date', () => {
    const info = moonInfo(utc(2026, 10, 27, 6));
    expect(info.phase).toBeGreaterThanOrEqual(0);
    expect(info.phase).toBeLessThan(1);
    expect(info.illumination).toBeGreaterThanOrEqual(0);
    expect(info.illumination).toBeLessThanOrEqual(1);
    expect(info.name).toMatch(/moon|quarter/i);
  });
});

describe('Zodiac and daily stars', () => {
  it('returns the zodiac sign for a date', () => {
    expect(constellationForDate(utc(2026, 1, 1)).key).toBe('capricornus');
    expect(constellationForDate(utc(2026, 4, 1)).key).toBe('aries');
    expect(constellationForDate(utc(2026, 8, 1)).key).toBe('leo');
    expect(constellationForDate(utc(2026, 10, 27)).key).toBe('scorpius');
  });

  it('handles zodiac boundaries including the December wrap', () => {
    expect(constellationForDate(utc(2026, 12, 21)).key).toBe('sagittarius');
    expect(constellationForDate(utc(2026, 12, 22)).key).toBe('capricornus');
    expect(constellationForDate(utc(2026, 1, 19)).key).toBe('capricornus');
    expect(constellationForDate(utc(2026, 1, 20)).key).toBe('aquarius');
    expect(constellationForDate(utc(2026, 2, 18)).key).toBe('aquarius');
    expect(constellationForDate(utc(2026, 2, 19)).key).toBe('pisces');
  });

  it('chooses a star of the day from the constellation', () => {
    const constellation = constellationForDate(utc(2026, 10, 27));
    expect(constellation.special).toBeDefined();
    expect(constellation.stars).toContain(constellation.special);
    expect(constellation.specialIndex).toBeGreaterThanOrEqual(0);
    expect(constellation.specialIndex).toBeLessThan(constellation.stars.length);
    expect(starOfDay(utc(2026, 10, 27))).toEqual(constellation.special);
  });

  it('has a complete catalogue', () => {
    expect(CONSTELLATIONS).toHaveLength(12);
    for (const constellation of CONSTELLATIONS) {
      expect(constellation.name).toBeTruthy();
      expect(constellation.stars.length).toBeGreaterThanOrEqual(4);
      for (const [from, to] of constellation.lines) {
        expect(constellation.stars[from]).toBeDefined();
        expect(constellation.stars[to]).toBeDefined();
      }
    }
  });

  it('rotates the special star while the constellation stays put', () => {
    const first = constellationForDate(utc(2026, 10, 23));
    const second = constellationForDate(utc(2026, 10, 24));
    expect(second.key).toBe(first.key);
    expect(second.specialIndex).not.toBe(first.specialIndex);
  });
});

describe('Date helpers', () => {
  it('formats UTC dates and day numbers', () => {
    expect(dateKey(utc(2026, 1, 2))).toBe('2026-01-02');
    expect(dayOfYear(utc(2026, 1, 1, 0))).toBe(1);
    expect(dayOfYear(utc(2026, 12, 31, 0))).toBe(365);
    expect(dayOfYear(utc(2028, 12, 31, 0))).toBe(366);
  });

  it('hashes strings deterministically', () => {
    expect(hashString('garden')).toBe(hashString('garden'));
    expect(hashString('garden')).not.toBe(hashString('Garden'));
    expect(hashString('')).toBe(2166136261);
    expect(hashString(42)).toBe(hashString('42'));
  });
});
