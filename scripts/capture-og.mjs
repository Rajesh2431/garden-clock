import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const outFile = `${root}public/og.png`;

const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : 5174;

const browser = await chromium.launch();

try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  await page.addInitScript(() => {
    localStorage.setItem('garden-clock:theme', JSON.stringify('noir'));
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(_success, failure) {
          setTimeout(() => failure?.({ code: 1, message: 'denied for capture' }), 0);
        },
      },
    });
  });

  await page.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({
      json: {
        timezone: 'Asia/Kolkata',
        utc_offset_seconds: 19800,
        current: {
          temperature_2m: 24,
          relative_humidity_2m: 64,
          apparent_temperature: 26,
          precipitation: 0,
          weather_code: 0,
          wind_speed_10m: 9,
          wind_direction_10m: 240,
          is_day: 1,
        },
        daily: { sunrise: ['2026-10-27T06:03'], sunset: ['2026-10-27T17:49'] },
      },
    }),
  );
  await page.route('**/timeapi.io/**', (route) =>
    route.fulfill({
      json: {
        year: 2026,
        month: 10,
        day: 27,
        hour: 6,
        minute: 0,
        seconds: 42,
        milliSeconds: 0,
        dateTime: '2026-10-27T06:00:42.0000000',
        timeZone: 'Etc/UTC',
      },
    }),
  );
  await page.route('**/cloudflare.com/**', (route) =>
    route.fulfill({ type: 'text/plain', body: 'ts=1793080842.000\n' }),
  );

  await page.clock.install({ time: new Date('2026-10-27T11:30:42+05:30') });
  await page.goto(`http://127.0.0.1:${port}/?seed=1234&kiosk=1`, {
    waitUntil: 'networkidle',
  });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: outFile, type: 'png' });
  console.log(`Wrote ${outFile}`);
} finally {
  await browser.close();
  await server.close();
}
