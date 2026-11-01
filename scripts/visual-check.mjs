import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Usage: node scripts/visual-check.mjs [output-dir] [base-url]
// Expects `npm run preview` to be serving the production build.
const out = process.argv[2] || join(tmpdir(), 'garden-clock-visual');
const baseUrl = process.argv[3] || 'http://127.0.0.1:4173';
await mkdir(out, { recursive: true });

const weather = {
  timezone: 'Asia/Kolkata',
  utc_offset_seconds: 19800,
  current: {
    temperature_2m: 31,
    relative_humidity_2m: 70,
    apparent_temperature: 36,
    precipitation: 0,
    weather_code: 0,
    wind_speed_10m: 12,
    wind_direction_10m: 220,
    is_day: 1,
  },
  daily: {
    sunrise: ['2026-10-27T06:03'],
    sunset: ['2026-10-27T17:49'],
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(_success, failure) {
        failure({ code: 1, message: 'visual check' });
      },
    },
  });
});
await page.route('**/fonts.googleapis.com/**', (route) =>
  route.fulfill({ contentType: 'text/css', body: '' }),
);
await page.route('**/fonts.gstatic.com/**', (route) =>
  route.fulfill({ contentType: 'font/woff2', body: '' }),
);
await page.route('**/api.open-meteo.com/**', (route) => route.fulfill({ json: weather }));
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
  route.fulfill({ contentType: 'text/plain', body: 'fl=test\nts=1793080842.000\n' }),
);
await page.clock.install({ time: new Date('2026-10-27T11:30:42+05:30') });
await page.goto(`${baseUrl}/?seed=1234`, { waitUntil: 'domcontentloaded' });
await page.locator('#w-temp').waitFor({ state: 'visible' });
await page.waitForTimeout(800);
await page.evaluate(() => document.fonts?.ready);

const cases = [
  ['desktop-noir-rain', 'noir', 'autumn', 'rain'],
  ['desktop-morning', 'morning', 'spring', 'clear'],
  ['desktop-afternoon', 'afternoon', 'summer', 'clear'],
  ['desktop-evening', 'evening', 'autumn', 'clear'],
  ['desktop-night', 'night', 'winter', 'clear'],
  ['desktop-glass-snow', 'glass', 'winter', 'snow'],
  ['desktop-forest-fog', 'forest', 'autumn', 'fog'],
  ['desktop-neon', 'neon', 'summer', 'cloud'],
];
for (const [name, theme, season, sim] of cases) {
  await page.selectOption('#theme', theme);
  await page.selectOption('#season', season);
  await page.selectOption('#sim', sim);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.png` });
}

await page.selectOption('#theme', 'afternoon');
await page.selectOption('#season', 'spring');
await page.selectOption('#sim', 'clear');
await page.waitForTimeout(400);
await page.mouse.click(300, 300);
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/desktop-click.png` });

await page.setViewportSize({ width: 390, height: 844 });
await page.selectOption('#theme', 'afternoon');
await page.selectOption('#season', 'summer');
await page.selectOption('#sim', 'clear');
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/mobile-afternoon.png` });

await browser.close();
console.log(`Screenshots written to ${out}`);
