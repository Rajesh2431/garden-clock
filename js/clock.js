// NTP-lite clock synchronisation and IANA-timezone formatting.
//
// worldtimeapi.org has become unreliable, so the primary source is timeapi.io
// and the fallback reads the unix timestamp from Cloudflare's CORS-enabled
// trace endpoint. Both are key-free. The local system clock is always the final
// fallback.

export const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 4500;

let offset = 0;
let lastSync = null;
let lastSource = '';
let lastRtt = 0;
let lastError = '';

export const now = () => Date.now() + offset;

export function syncInfo() {
  return { offset, lastSync, source: lastSource, rtt: lastRtt, error: lastError };
}

export function resetClock() {
  offset = 0;
  lastSync = null;
  lastSource = '';
  lastRtt = 0;
  lastError = '';
}

export function parseTimeApiDate(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const text = value.trim();
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
  return Date.parse(hasZone ? text : `${text}Z`);
}

export function parseHttpDate(value) {
  if (!value) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Cloudflare's /cdn-cgi/trace response ends with `ts=<unix seconds>`.
 * It is plain text and served with Access-Control-Allow-Origin: *.
 */
export function parseCloudflareTrace(text) {
  if (typeof text !== 'string') return NaN;
  const match = text.match(/(?:^|\n)ts=(\d+(?:\.\d+)?)(?:\n|$)/);
  if (!match) return NaN;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : NaN;
}

export function estimateOffset(serverMs, t0, t1, localMs = Date.now()) {
  if (![serverMs, t0, t1, localMs].every(Number.isFinite)) return NaN;
  return serverMs + (t1 - t0) / 2 - localMs;
}

export const TIME_PROVIDERS = [
  {
    name: 'timeapi.io',
    url: 'https://timeapi.io/api/Time/current/zone?timeZone=Etc/UTC',
    init: { cache: 'no-store' },
    async read(response) {
      const text = await response.text();
      const payload = JSON.parse(text);
      return parseTimeApiDate(payload.dateTime);
    },
  },
  {
    name: 'cloudflare-trace',
    // Plain text, key-free and CORS-enabled. The body carries a unix timestamp.
    url: 'https://cloudflare.com/cdn-cgi/trace',
    init: { cache: 'no-store' },
    async read(response) {
      return parseCloudflareTrace(await response.text());
    },
  },
];

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  if (!timeoutMs) return fetchImpl(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Take several samples and keep the one with the lowest round-trip time.
 * Dependencies are injectable so the algorithm can be tested without a network.
 */
export async function syncTime(options = {}) {
  const {
    samples = 3,
    fetchImpl = globalThis.fetch,
    perfNow = () => performance.now(),
    nowMs = Date.now,
    providers = TIME_PROVIDERS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (typeof fetchImpl !== 'function') {
    lastError = 'fetch unavailable';
    return { ok: false, error: lastError };
  }

  let best = null;
  const errors = [];

  for (let i = 0; i < Math.max(1, samples); i += 1) {
    for (const provider of providers) {
      try {
        const t0 = perfNow();
        const response = await fetchWithTimeout(fetchImpl, provider.url, provider.init || {}, timeoutMs);
        if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'error'}`);
        const serverMs = await provider.read(response);
        const t1 = perfNow();
        if (!Number.isFinite(serverMs)) throw new Error('invalid server time');

        const localMs = nowMs();
        const sampleOffset = estimateOffset(serverMs, t0, t1, localMs);
        if (!Number.isFinite(sampleOffset)) throw new Error('invalid offset');
        const rtt = Math.max(0, t1 - t0);

        if (!best || rtt < best.rtt) {
          best = { offset: sampleOffset, rtt, source: provider.name };
        }
        // A successful provider is enough for this sample.
        break;
      } catch (error) {
        errors.push(`${provider.name}: ${error?.message || 'failed'}`);
      }
    }
  }

  if (!best) {
    lastError = errors.at(-1) || 'time sync failed';
    return { ok: false, error: lastError };
  }

  offset = best.offset;
  lastSync = new Date();
  lastSource = best.source;
  lastRtt = best.rtt;
  lastError = '';
  return { ok: true, ...best };
}

const formatCache = new Map();
const localZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

function safeZone(timeZone) {
  if (!timeZone) return localZone;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(0);
    return timeZone;
  } catch {
    return localZone;
  }
}

function makeFormatter(timeZone, hour12) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: hour12 ? 'h12' : 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function makeHourFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
  });
}

function makeZoneNameFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeZoneName: 'short',
  });
}

function zoneName(formatter, date) {
  const part = formatter.formatToParts(date).find((item) => item.type === 'timeZoneName');
  return part?.value || '';
}

/**
 * Return the wall-clock parts for a timezone at a given instant.
 * DST and historical offsets are handled by Intl.
 */
export function parts(timeZone, hour12 = false, timestamp = now()) {
  const zone = safeZone(timeZone);
  const key = `${zone}:${hour12 ? '12' : '24'}`;
  let formatter = formatCache.get(key);
  if (!formatter) {
    formatter = makeFormatter(zone, hour12);
    formatCache.set(key, formatter);
  }
  let hourFormatter = formatCache.get(`${zone}:hour`);
  if (!hourFormatter) {
    hourFormatter = makeHourFormatter(zone);
    formatCache.set(`${zone}:hour`, hourFormatter);
  }
  let zoneFormatter = formatCache.get(`${zone}:name`);
  if (!zoneFormatter) {
    zoneFormatter = makeZoneNameFormatter(zone);
    formatCache.set(`${zone}:name`, zoneFormatter);
  }

  const date = new Date(timestamp);
  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  const hour24 = Number(hourFormatter.format(date)) % 24;

  return {
    hh: String(values.hour || '00').padStart(2, '0'),
    mm: String(values.minute || '00').padStart(2, '0'),
    ss: String(values.second || '00').padStart(2, '0'),
    meridiem: values.dayPeriod || '',
    date: `${values.weekday || ''} · ${values.day || ''} ${values.month || ''} ${values.year || ''}`.trim(),
    hour24,
    timeZone: zone,
    tzName: zoneName(zoneFormatter, date),
    timestamp,
  };
}
