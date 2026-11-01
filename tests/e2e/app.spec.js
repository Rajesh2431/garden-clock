import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

const FIXED_TIME = new Date('2026-10-27T11:30:42+05:30');
const FIXED_UTC = '2026-10-27T06:00:42.0000000';
const GROWTH_KEY = 'garden-clock:growth:v1';

const CHENNAI_WEATHER = {
  timezone: 'Asia/Kolkata',
  utc_offset_seconds: 19800,
  current: {
    temperature_2m: 31,
    relative_humidity_2m: 70,
    apparent_temperature: 36,
    precipitation: 0,
    weather_code: 61,
    wind_speed_10m: 12,
    wind_direction_10m: 220,
    is_day: 1,
  },
  daily: {
    sunrise: ['2026-10-27T06:03'],
    sunset: ['2026-10-27T17:49'],
  },
};

const TOKYO_WEATHER = {
  ...CHENNAI_WEATHER,
  timezone: 'Asia/Tokyo',
  utc_offset_seconds: 32400,
  current: {
    ...CHENNAI_WEATHER.current,
    temperature_2m: 18,
    weather_code: 0,
  },
  daily: {
    sunrise: ['2026-10-27T05:57'],
    sunset: ['2026-10-27T16:51'],
  },
};

const TOKYO_RESULT = {
  results: [
    {
      id: 1850147,
      name: 'Tokyo',
      latitude: 35.6895,
      longitude: 139.6917,
      country_code: 'JP',
      country: 'Japan',
      admin1: 'Tokyo',
      timezone: 'Asia/Tokyo',
    },
  ],
};

function timePayload(dateTime = FIXED_UTC) {
  return {
    year: 2026,
    month: 10,
    day: 27,
    hour: 6,
    minute: 0,
    seconds: 42,
    milliSeconds: 0,
    dateTime,
    timeZone: 'Etc/UTC',
  };
}

async function mockApis(page, options = {}) {
  const { weather = () => CHENNAI_WEATHER, timeStatus = 200, geocoding = null } = options;

  await page.route('**/fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
  await page.route('**/fonts.gstatic.com/**', (route) =>
    route.fulfill({ contentType: 'font/woff2', body: '' }),
  );

  await page.route('**/api.open-meteo.com/**', (route) => {
    route.fulfill({ json: weather(route.request().url()) });
  });

  await page.route('**/timeapi.io/**', (route) => {
    if (timeStatus !== 200) {
      route.fulfill({ status: timeStatus, body: 'time service down' });
      return;
    }
    route.fulfill({ json: timePayload() });
  });

  await page.route('**/cloudflare.com/**', (route) => {
    if (timeStatus !== 200) {
      route.fulfill({ status: timeStatus, body: 'time service down' });
      return;
    }
    route.fulfill({
      contentType: 'text/plain',
      body: 'fl=test\nts=1793080842.000\nvisit_scheme=https\n',
    });
  });

  if (geocoding) {
    await page.route('**/geocoding-api.open-meteo.com/**', (route) =>
      route.fulfill({ json: geocoding(route.request().url()) }),
    );
  }
}

async function openApp(page, options = {}) {
  const { url = '/', weather, timeStatus, geocoding, viewport, storage } = options;
  if (viewport) await page.setViewportSize(viewport);
  if (storage) {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), storage);
  }
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(_success, failure) {
          failure({ code: 1, message: 'denied by the test' });
        },
      },
    });
  });
  await mockApis(page, { weather, timeStatus, geocoding });
  await page.clock.install({ time: FIXED_TIME });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#w-temp')).toHaveText(/\d+°C/, { timeout: 15_000 });
}

test('renders the clock, date, weather and synced status', async ({ page }) => {
  await openApp(page);

  await expect(page.locator('#hh')).toHaveText('11');
  await expect(page.locator('#mm')).toHaveText('30');
  await expect(page.locator('#ss')).toHaveText(/^\d{2}$/);
  await expect(page.locator('#date')).toContainText('27 Oct 2026');
  await expect(page.locator('#tz')).not.toBeEmpty();
  await expect(page.locator('#tz')).not.toContainText('27/10/2026');
  await expect(page.locator('#w-temp')).toHaveText('31°C');
  await expect(page.locator('#w-desc')).toHaveText('Light rain · Chennai');
  await expect(page.locator('#w-meta')).toContainText('Sunrise 06:03');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'noir');
  await expect(page.locator('#sync')).toHaveAttribute('data-state', 'ok');

  await expect(page.locator('h1')).toHaveText('Garden Clock');
  await expect(page.locator('#time')).toHaveAttribute('aria-live', 'off');
  await expect(page.locator('label[for="city"]')).toHaveCount(1);
});

test('explicit theme and weather simulator stay independent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error));
  await openApp(page);

  await page.selectOption('#theme', 'glass');
  await expect(page.locator('body')).toHaveClass(/glass/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'glass');

  await page.selectOption('#sim', 'storm');
  await expect(page.locator('#sim-badge')).toBeVisible();
  await expect(page.locator('#sim-badge')).toHaveText('Simulating Thunderstorm');
  await expect(page.locator('body')).toHaveClass(/glass/);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('every theme and simulated weather renders without page errors', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error));
  await openApp(page);

  const themes = [
    'morning',
    'afternoon',
    'evening',
    'night',
    'noir',
    'glass',
    'sakura',
    'neon',
    'sunset',
    'forest',
  ];
  const kinds = ['clear', 'cloud', 'fog', 'drizzle', 'rain', 'storm', 'snow'];
  for (const theme of themes) {
    await page.selectOption('#theme', theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const kind of kinds) {
      await page.selectOption('#sim', kind);
      await page.waitForTimeout(40);
    }
  }

  expect(errors).toEqual([]);
});

test('offers the full theme, season and weather catalogue', async ({ page }) => {
  await openApp(page);

  await expect(page.locator('#theme option')).toHaveCount(11);
  await expect(page.locator('#season option')).toHaveCount(5);
  await expect(page.locator('#sim option')).toHaveCount(8);
  await expect(page.locator('body')).toHaveAttribute('data-season', 'autumn');
  await expect(page.locator('#sky-note')).toContainText('Scorpius');
  await expect(page.locator('#sky-note')).toContainText('Autumn garden');
  await expect(page.locator('#sky')).toBeVisible();
});

test('time themes drive the sky and its daily constellation', async ({ page }) => {
  await openApp(page);

  await page.selectOption('#theme', 'night');
  await expect(page.locator('#sky-note')).toContainText('Night');
  await page.selectOption('#sim', 'clear');
  const nightPixels = await page.locator('#sky').evaluate((canvas) => {
    const context = canvas.getContext('2d');
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit += 1;
    return lit;
  });
  expect(nightPixels).toBeGreaterThan(100);

  await page.selectOption('#theme', 'evening');
  await expect(page.locator('#sky-note')).toContainText('Evening');
  await page.selectOption('#theme', 'morning');
  await expect(page.locator('#sky-note')).toContainText('Morning');
});

test('the season selector changes the garden and its label', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('body')).toHaveAttribute('data-season', 'autumn');

  await page.selectOption('#season', 'summer');
  await expect(page.locator('body')).toHaveAttribute('data-season', 'summer');
  await expect(page.locator('#sky-note')).toContainText('Summer garden');

  await page.selectOption('#season', 'winter');
  await expect(page.locator('body')).toHaveAttribute('data-season', 'winter');
  await expect(page.locator('#sky-note')).toContainText('Winter garden');

  await page.selectOption('#season', 'auto');
  await expect(page.locator('body')).toHaveAttribute('data-season', 'autumn');
});

test('restores and continuously grows a saved garden', async ({ page }) => {
  test.setTimeout(30_000);
  await openApp(page, {
    url: '/?seed=1234&debug=1',
    storage: {
      key: GROWTH_KEY,
      value: { seed: 1234, count: 5, at: FIXED_TIME.getTime() },
    },
  });
  const debug = page.locator('#debug');
  await expect(debug).toContainText('growth 5/28');

  await page.clock.runFor(18_500);
  await expect(debug).toContainText('growth 6/28');
  await page.clock.runFor(18_500);
  await expect(debug).toContainText('growth 7/28');
});

test('clicking the scene blooms a flower in reduced motion', async ({ page }) => {
  await openApp(page, { url: '/?seed=1234&debug=1' });
  const debug = page.locator('#debug');

  await page.locator('#stage').click({ position: { x: 720, y: 480 } });
  await expect(debug).toContainText('blooms 1');
  await expect(debug).toContainText('visitors 0');
});

test('toggles 12-hour time and seconds', async ({ page }) => {
  await openApp(page);

  await page.locator('#h12').check();
  await expect(page.locator('#meridiem')).toHaveText(/am|pm/i);
  await expect(page.locator('body')).not.toHaveClass(/no-meridiem/);

  await page.locator('#secs').uncheck();
  await expect(page.locator('body')).toHaveClass(/no-seconds/);
  await expect(page.locator('#ss')).toBeHidden();
});

test('city search updates the clock, weather and timezone', async ({ page }) => {
  await openApp(page, {
    weather: (url) => {
      const latitude = Number(new URL(url).searchParams.get('latitude'));
      return latitude > 30 ? TOKYO_WEATHER : CHENNAI_WEATHER;
    },
    geocoding: () => TOKYO_RESULT,
  });

  await page.locator('#city').fill('Tokyo');
  await expect(page.locator('#city-list option')).toHaveCount(1);
  await page.locator('#city').press('Enter');

  await expect(page.locator('#w-temp')).toHaveText('18°C');
  await expect(page.locator('#w-desc')).toHaveText('Clear sky · Tokyo');
  await expect(page.locator('#hh')).toHaveText('15');
  await expect(page.locator('#mm')).toHaveText('00');
  await expect(page.locator('#tz')).toContainText('GMT+9');
});

test('regrow creates a fresh seed and persists it in the URL', async ({ page }) => {
  await openApp(page, { url: '/?seed=1234' });
  expect(new URL(page.url()).searchParams.get('seed')).toBe('1234');

  await page.locator('#regrow').click();
  await expect(page.locator('#toast')).toContainText('A new garden is growing');

  const nextSeed = await page.evaluate(() => new URL(location.href).searchParams.get('seed'));
  expect(nextSeed).toBeTruthy();
  expect(nextSeed).not.toBe('1234');
});

test('regrow shortcut creates a seed and removes the flag', async ({ page }) => {
  await openApp(page, { url: '/?seed=1234&regrow=1' });

  const url = new URL(page.url());
  expect(url.searchParams.get('regrow')).toBeNull();
  expect(url.searchParams.get('seed')).not.toBe('1234');
});

test('saves the scene as a PNG', async ({ page }) => {
  await openApp(page);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^garden-clock-\d+\.png$/);
});

test('falls back to cached weather when a refresh fails', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#w-temp')).toHaveText('31°C');

  await page.route('**/api.open-meteo.com/**', (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(page.locator('#w-stale')).toBeVisible();
  await expect(page.locator('#w-stale')).toContainText('Offline · updated');
  await expect(page.locator('#w-temp')).toHaveText('31°C');
  await expect(page.locator('#w-retry')).toBeVisible();
});

test('falls back to the local clock when time services are down', async ({ page }) => {
  await openApp(page, { timeStatus: 503 });

  await expect(page.locator('#sync')).toHaveAttribute('data-state', 'local');
  await expect(page.locator('#sync')).toHaveText('Local clock');
  await expect(page.locator('#hh')).toHaveText('11');
});

test('keyboard shortcut H hides and shows the controls', async ({ page }) => {
  await openApp(page);

  await page.keyboard.press('h');
  await expect(page.locator('#controls')).toBeHidden();
  await page.keyboard.press('h');
  await expect(page.locator('#controls')).toBeVisible();
});

test('shortcuts still work while a control button has focus', async ({ page }) => {
  await openApp(page);

  await page.focus('#regrow');
  await page.keyboard.press('h');
  await expect(page.locator('#controls')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#controls')).toBeVisible();

  // Typing in the city field must not trigger shortcuts.
  await page.focus('#city');
  await page.keyboard.type('h');
  await expect(page.locator('#controls')).toBeVisible();
});

test('mobile layout fits a 360px viewport', async ({ page }) => {
  await openApp(page, { viewport: { width: 360, height: 800 } });

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    width: window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.width + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.width + 1);

  const controls = await page.locator('#controls').boundingBox();
  expect(controls).toBeTruthy();
  expect(controls.x).toBeGreaterThanOrEqual(0);
  expect(controls.x + controls.width).toBeLessThanOrEqual(361);

  await expect(page.locator('#time')).toBeVisible();
  await expect(page.locator('#w-temp')).toBeVisible();
});

test.describe('animated garden', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('clicking the scene blooms a flower and calls a butterfly', async ({ page }) => {
    await openApp(page, { url: '/?seed=1234&debug=1' });
    const debug = page.locator('#debug');
    await expect(debug).toContainText('visitors 2');

    await page.locator('#stage').click({ position: { x: 720, y: 480 } });
    await expect(debug).toContainText('blooms 1');
    await expect(debug).toContainText('visitors 3');
  });
});

test('ships the manifest, icons and service worker', async ({ request }) => {
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe('Garden Clock');
  expect(manifest.display).toBe('fullscreen');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

  for (const icon of manifest.icons) {
    const response = await request.get(`/${icon.src}`);
    expect(response.ok(), icon.src).toBe(true);
  }

  expect((await request.get('/sw.js')).ok()).toBe(true);
  expect((await request.get('/og.png')).ok()).toBe(true);
});
