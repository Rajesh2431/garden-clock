import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SYNC_INTERVAL_MS,
  estimateOffset,
  now,
  parseCloudflareTrace,
  parseHttpDate,
  parseTimeApiDate,
  parts,
  resetClock,
  syncInfo,
  syncTime,
  wallDate,
} from '../../js/clock.js';

beforeEach(() => {
  resetClock();
});

describe('time parsers', () => {
  it('parses the zoneless timeapi.io date as UTC', () => {
    const parsed = parseTimeApiDate('2026-10-26T20:19:16.0621867');
    expect(parsed).toBe(Date.parse('2026-10-26T20:19:16.062Z'));
  });

  it('does not append a second zone to an explicit offset', () => {
    expect(parseTimeApiDate('2026-10-26T20:19:16Z')).toBe(Date.parse('2026-10-26T20:19:16Z'));
    expect(parseTimeApiDate('2026-10-26T20:19:16+02:00')).toBe(Date.parse('2026-10-26T18:19:16Z'));
  });

  it('rejects empty and invalid time strings', () => {
    expect(parseTimeApiDate('')).toBeNaN();
    expect(parseTimeApiDate(null)).toBeNaN();
    expect(parseTimeApiDate('not a date')).toBeNaN();
  });

  it('parses the Cloudflare trace timestamp', () => {
    const trace = 'fl=123\nh=cloudflare.com\nts=1793045958.000\nvisit_scheme=https\n';
    expect(parseCloudflareTrace(trace)).toBe(1793045958000);
    expect(parseCloudflareTrace('ts=1793045958')).toBe(1793045958000);
    expect(parseCloudflareTrace('no timestamp here')).toBeNaN();
    expect(parseCloudflareTrace(undefined)).toBeNaN();
  });

  it('parses HTTP dates', () => {
    expect(parseHttpDate('Mon, 26 Oct 2026 20:19:16 GMT')).toBe(Date.parse('2026-10-26T20:19:16Z'));
    expect(parseHttpDate('')).toBeNaN();
    expect(parseHttpDate('nope')).toBeNaN();
  });

  it('compensates the offset for half the round-trip', () => {
    const local = 10_000;
    expect(estimateOffset(10_100, 100, 300, local)).toBe(200);
    expect(estimateOffset(10_000, 100, 300, local)).toBe(100);
    expect(estimateOffset(NaN, 100, 300, local)).toBeNaN();
  });
});

describe('syncTime', () => {
  it('keeps the lowest-RTT sample and applies the offset', async () => {
    const serverMs = Date.UTC(2026, 9, 26, 20, 19, 16);
    const localMs = serverMs - 5000;
    const rtts = [200, 40, 100];
    const clock = rtts.flatMap((rtt) => [1000, 1000 + rtt]);
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const provider = {
      name: 'fake',
      url: 'https://example.test/time',
      read: async () => serverMs,
    };

    const result = await syncTime({
      samples: 3,
      fetchImpl,
      perfNow: () => clock.shift(),
      nowMs: () => localMs,
      providers: [provider],
      timeoutMs: 0,
    });

    expect(result).toMatchObject({ ok: true, rtt: 40, source: 'fake', offset: 5020 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(syncInfo().offset).toBe(5020);
    expect(syncInfo().lastSync).toBeInstanceOf(Date);
    expect(Math.abs(now() - Date.now() - 5020)).toBeLessThan(1000);
  });

  it('falls back to the next provider', async () => {
    const serverMs = Date.UTC(2026, 9, 26, 20, 19, 16);
    const clock = [0, 10, 20, 30];
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const providers = [
      { name: 'broken', url: 'https://bad.test', read: async () => NaN },
      { name: 'good', url: 'https://good.test', read: async () => serverMs },
    ];

    const result = await syncTime({
      samples: 1,
      fetchImpl,
      perfNow: () => clock.shift(),
      nowMs: () => serverMs,
      providers,
      timeoutMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('good');
    expect(result.rtt).toBe(10);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports a local-clock fallback when every provider fails', async () => {
    const result = await syncTime({
      samples: 2,
      fetchImpl: vi.fn(async () => ({ ok: false, status: 503 })),
      perfNow: () => 0,
      nowMs: () => 0,
      providers: [{ name: 'down', url: 'https://down.test', read: async () => 0 }],
      timeoutMs: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('down');
    expect(syncInfo().offset).toBe(0);
    expect(syncInfo().error).toContain('down');
  });

  it('survives a missing fetch implementation', async () => {
    const result = await syncTime({ fetchImpl: null });
    expect(result).toEqual({ ok: false, error: 'fetch unavailable' });
  });

  it('uses a ten-minute resync interval', () => {
    expect(SYNC_INTERVAL_MS).toBe(10 * 60 * 1000);
  });
});

describe('parts', () => {
  it('formats Tokyo, London, New York and Kolkata at the same instant', () => {
    const timestamp = Date.parse('2026-01-15T12:00:00Z');
    expect(parts('Asia/Tokyo', false, timestamp)).toMatchObject({
      hh: '21',
      mm: '00',
      date: 'Thu · 15 Jan 2026',
    });
    expect(parts('Europe/London', false, timestamp)).toMatchObject({ hh: '12', mm: '00' });
    expect(parts('America/New_York', false, timestamp)).toMatchObject({ hh: '07', mm: '00' });
    expect(parts('Asia/Kolkata', false, timestamp)).toMatchObject({ hh: '17', mm: '30' });
  });

  it('handles daylight saving time through Intl', () => {
    const winter = Date.parse('2026-01-15T12:00:00Z');
    const summer = Date.parse('2026-07-15T12:00:00Z');
    expect(parts('America/New_York', false, winter).hh).toBe('07');
    expect(parts('America/New_York', false, summer).hh).toBe('08');
    expect(parts('Europe/London', false, winter).hh).toBe('12');
    expect(parts('Europe/London', false, summer).hh).toBe('13');
  });

  it('formats 12-hour time with a meridiem', () => {
    const clock = parts('Asia/Kolkata', true, Date.parse('2026-01-15T12:00:00Z'));
    expect(clock).toMatchObject({
      hh: '05',
      mm: '30',
      meridiem: 'pm',
      hour24: 17,
    });
  });

  it('returns a compact zone name without repeating the date', () => {
    const clock = parts('Asia/Kolkata', false, Date.parse('2026-01-15T12:00:00Z'));
    expect(clock.tzName).toBeTruthy();
    expect(clock.tzName).not.toContain('/');
    expect(clock.tzName).not.toContain('2026');
  });

  it('falls back safely for an unknown zone', () => {
    const clock = parts('Not/AZone', false, Date.parse('2026-01-15T12:00:00Z'));
    expect(clock.timeZone).toBeTruthy();
    expect(clock.hh).toMatch(/^\d{2}$/);
    expect(clock.mm).toMatch(/^\d{2}$/);
  });
});

describe('wallDate', () => {
  it('maps an instant to the wall-clock date in the given zone', () => {
    // 2026-03-20T20:00Z is already 01:30 on 21 March in Kolkata.
    const instant = Date.UTC(2026, 2, 20, 20, 0, 0);
    const kolkata = wallDate('Asia/Kolkata', instant);
    expect(kolkata.toISOString()).toBe('2026-03-21T01:30:00.000Z');
    const newYork = wallDate('America/New_York', instant);
    expect(newYork.toISOString()).toBe('2026-03-20T16:00:00.000Z');
  });

  it('falls back to the local zone for an invalid zone', () => {
    const instant = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(Number.isFinite(wallDate('Not/AZone', instant).getTime())).toBe(true);
  });
});
