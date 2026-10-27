// Optional, privacy-friendly monitoring. Nothing is sent unless an endpoint is
// configured at build time; theme and weather kind are the only analytics data.

const errorEndpoint = import.meta.env.VITE_ERROR_ENDPOINT || '';
const analyticsEndpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT || '';

function send(endpoint, payload) {
  if (!endpoint) return;
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Monitoring must never affect the clock.
  }
}

export function track(name, properties = {}) {
  if (!analyticsEndpoint) return;
  send(analyticsEndpoint, { name, ...properties, ts: Date.now() });
}

export function reportError(error, context = {}) {
  const message = typeof error === 'string' ? error : error?.message || 'Unknown error';
  const stack = typeof error === 'object' ? error?.stack || '' : '';
  console.error('[GardenClock]', message, context);
  if (!errorEndpoint) return;
  send(errorEndpoint, {
    type: 'error',
    message: String(message).slice(0, 500),
    stack: String(stack).slice(0, 2000),
    ...context,
    ts: Date.now(),
  });
}

export function initMonitoring() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (event) => {
    reportError(event.error || event.message, {
      source: event.filename || '',
      line: event.lineno || 0,
      column: event.colno || 0,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason || 'Unhandled promise rejection');
  });
}
