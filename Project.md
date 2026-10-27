Garden Clock: Full Phase-by-Phase Development Workflow
By Claude for Rajesh. Stack: vanilla JS, Canvas 2D, Open-Meteo, Vite, GitHub Actions, Vercel or Docker/nginx. Starter code: garden-clock.zip (already delivered).
0. Overview and Roadmap
Phase
Goal
Output
Est. time
0
Discovery and scope
Spec, feature list
0.5 day
1
Design
Tokens, themes, wireframe, reference art
1 day
2
Repo and tooling
Git repo, Vite, lint, hooks
0.5 day
3
Clock and time sync
Accurate multi-timezone clock
1 day
4
Weather integration
Live weather, geocoding, caching
1 day
5
Garden engine
Procedural vines, leaves, flowers
2 to 3 days
6
Weather FX
Rain, snow, fog, storm, clouds, stars
1 to 2 days
7
Themes and auto-theme
6+ themes, weather-driven switching
1 day
8
UI, responsive, accessibility
Controls, mobile, a11y
1 day
9
Performance
60 fps, battery friendly
1 day
10
Testing
Unit, E2E, visual checks
1 to 2 days
11
PWA and offline
Installable app
0.5 day
12
CI/CD and deploy
GitHub Actions, Vercel, Docker
0.5 day
13
Monitoring and release
Analytics, error tracking, versioning
0.5 day
14
v2 roadmap
Idle growth, forecast, sound
ongoing
Working rules for every phase:
• One feature branch per phase: feat/phase-3-clock.
• Conventional commits: feat:, fix:, perf:, test:, chore:, docs:.
• A phase is done only when its acceptance checklist passes.
• Merge to main through a pull request. Tag releases v0.x.0.
Phase 0. Discovery and Scope
Goal. Fix what v1 is, so scope does not creep.
Product statement. A full-screen live clock whose digits sit inside a living garden. The garden and sky react to real weather and local time.
Must have (v1)
• Live clock with seconds, 12h/24h toggle, timezone of the selected city.
• Internet time sync with latency compensation.
• Live weather: clear, cloudy, fog, rain, thunderstorm, snow, day and night.
• Procedural garden (vines, leaves, roses and daisies) that grows around the digits.
• 6 themes plus Auto.
• City search and geolocation.
• Responsive from 360 px phones to 4K.
Should have (v1.1)
• PWA install, offline mode with last known weather.
• Weather simulator for demos and testing.
• Hourly regrow, click to regrow.
Won't have (v1)
• Accounts, backend, paid APIs.
Non-functional targets
• First paint under 1.5 s on a mid-range phone, 55+ fps on desktop, JS payload under 60 KB gzipped, zero API keys.
Acceptance. The spec is written and agreed. The v1 list is frozen.
Phase 1. Design
1.1 Visual direction
• Reference 1: your sketch. The clock is centered, vines enter from the top corners and the bottom-left, and rose clusters sit left, right and bottom-right.
• Reference 2: the garden image. Royal-blue vines with pointed leaves and red spiral roses on black.
• Glass theme: white room, glass marble panel, soft caustics, glassmorphism.
1.2 Design tokens (these become CSS variables)
:root{
  --bg:#000; --digit:#fff; --glow:none; --ui:#fff;
  --inset:0px; --radius:0px; --panel:rgba(255,255,255,.08);
}
1.3 Layout (wireframe)
+--------------------------------------------+
| 24C  Clear sky - Chennai       (vines)      |
|  (vines)        11 : 30  42                 |
|   (roses)      WED - 27 OCT 2026  (roses)   |
|  (vines)                      (roses)       |
|  [city][theme][sim][12h][sec][regrow] sync  |
+--------------------------------------------+
1.4 Reference art. Use the image prompt from earlier in this chat to generate a hero image. Use it as the Open Graph image (og:image) and as a mood board for the glass theme.
1.5 Typography. Outfit, weight 200 for digits (thin strokes like your sketch), weight 300 for labels. Fallback: system-ui.
Acceptance. Tokens, wireframe, and a palette per theme are agreed.
Phase 2. Repository and Tooling
2.1 Machine setup (Arch Linux)
sudo pacman -S --needed git nodejs npm
node -v && npm -v
2.2 Create the project with Vite (vanilla)
npm create vite@latest garden-clock -- --template vanilla
cd garden-clock
npm i
npm i -D eslint prettier vitest jsdom @playwright/test husky lint-staged vite-plugin-pwa
npx playwright install chromium
Copy the starter files into place:
unzip ../garden-clock.zip -d /tmp/gc
cp -r /tmp/gc/garden-clock/{css,js,index.html} .
Vite serves index.html at the root and bundles js/main.js.
2.3 package.json scripts
{
  "scripts": {
    "dev": "vite --host",
    "build": "vite build",
    "preview": "vite preview --host",
    "lint": "eslint js",
    "format": "prettier -w .",
    "test": "vitest run",
    "e2e": "playwright test",
    "prepare": "husky"
  },
  "lint-staged": { "*.{js,css,html,md}": "prettier -w" }
}
2.4 .prettierrc and eslint.config.js
{ "singleQuote": true, "printWidth": 110 }
export default [{
  files: ['js/**/*.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'module',
    globals: { window:'readonly', document:'readonly', navigator:'readonly', localStorage:'readonly',
      performance:'readonly', fetch:'readonly', requestAnimationFrame:'readonly', devicePixelRatio:'readonly',
      innerWidth:'readonly', ResizeObserver:'readonly', Intl:'readonly', setTimeout:'readonly',
      setInterval:'readonly', clearTimeout:'readonly' } },
  rules: { 'no-unused-vars':'warn', 'no-undef':'error' }
}];
2.5 Git and hooks
git init -b main
npx husky init
echo "npx lint-staged && npm run lint && npm test" > .husky/pre-commit
git add . && git commit -m "chore: scaffold vite project"
2.6 Folder structure
garden-clock/
  index.html
  css/style.css
  js/{main,clock,weather,garden,fx,themes}.js
  public/{manifest.webmanifest,icon-192.png,icon-512.png,og.png}
  tests/{unit,e2e}/
  .github/workflows/ci.yml
  Dockerfile
  vite.config.js
Acceptance. npm run dev shows the app, npm run build succeeds, and the pre-commit hook runs.
Phase 3. Clock and Time Sync
3.1 Design. Never trust Date.now() alone. Keep offset = serverTime - localTime. Every read is Date.now() + offset.
3.2 Algorithm (NTP-lite)
1. Record t0 = performance.now().
2. Fetch UTC from the time API and record t1.
3. Assume the server stamp was taken at the midpoint, so server = stamp + (t1 - t0) / 2.
4. offset = server - Date.now().
5. Repeat 3 times, keep the sample with the lowest round-trip, resync every 10 minutes.
The starter does one sample. Upgrade it:
export async function syncTime(samples = 3){
  let best = null;
  for (let i = 0; i < samples; i++){
    try{
      const t0 = performance.now();
      const j = await (await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC',{cache:'no-store'})).json();
      const rtt = performance.now() - t0;
      const off = Date.parse(j.utc_datetime) + rtt/2 - Date.now();
      if (!best || rtt < best.rtt) best = { rtt, off };
    }catch{}
  }
  if (best){ offset = best.off; lastSync = new Date(); return true; }
  return false;
}
3.3 Timezones. Intl.DateTimeFormat with timeZone handles DST and every IANA zone. Open-Meteo returns the zone name (timezone=auto), so the clock follows the city you pick.
3.4 Rendering. Update the DOM only when the second changes (the starter already does this). Drive the canvas from requestAnimationFrame.
3.5 Edge cases
• Tab hidden then shown: recompute from now() and never accumulate.
• Sync API down: fall back to the local clock and show "local clock" in the UI.
• Offline: skip sync, keep the last offset.
Acceptance
• Clock matches time.is within 300 ms.
• Switching to Tokyo, London and New York shows the correct local time, including a DST date.
• The sync label updates every 10 minutes.
Phase 4. Weather Integration
4.1 API (free, no key)
• Forecast: https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day&timezone=auto
• Geocoding: https://geocoding-api.open-meteo.com/v1/search?name=Chennai&count=5
4.2 WMO code to visual kind
WMO codes
Kind
0, 1
clear
2, 3
cloud
45, 48
fog
51 to 67, 80 to 82
rain
71 to 77, 85, 86
snow
95 to 99
storm
4.3 Location resolution order
1. Saved city in localStorage.
2. Browser geolocation (6 s timeout).
3. Default: Chennai (13.0827, 80.2707).
4.4 Caching and failure handling. Cache the last response so the app works offline:
const KEY = 'weather-cache';
export async function fetchWeatherCached(lat, lon){
  try{
    const w = await fetchWeather(lat, lon);
    localStorage.setItem(KEY, JSON.stringify({ w, at: Date.now(), lat, lon }));
    return w;
  }catch(e){
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (c) return { ...c.w, stale: true };
    throw e;
  }
}
Show a small "offline, last updated" tag when stale is true.
4.5 City autocomplete (optional). Use count=5 and render a datalist as the user types, debounced at 300 ms.
Acceptance
• Searching a city updates weather, timezone and clock.
• Denying geolocation falls back to Chennai without errors.
• Airplane mode still shows the last cached weather.
Phase 5. Garden Engine
This is the heart of the project. Build it in four sub-steps.
5.1 Vine growth (random walk with attraction)
• Spawn at a random edge point.
• Pick a target inside the clock box.
• Each step: add a sine wobble plus noise to the heading, then steer slightly toward the target (ang += angleDiff * 0.02).
• Stop when the point enters the clock's bounding box. That makes vines wrap around the digits instead of covering them.
5.2 Decoration
• Leaves every 4 points, alternating sides, a pointed ellipse built from two quadratic curves.
• Flowers randomly along the vine (3.5 percent per point) plus one at every tip.
• Clusters of 6 to 10 roses at the left, right and bottom-right of the clock, matching your sketch.
5.3 Animation
• Growth runs over 7 s with ease-out cubic. Each vine has its own delay.
• Flowers bloom by scaling from 0 to full radius once the vine reaches them.
• Idle motion: leaf angle sways with sin(time + index), amplitude scaled by wind speed. Flowers pulse by 3 percent.
5.4 Flower renderers
• Rose: a lobed blob (r * (1 + .14 sin(5a + phase))) filled with the flower color, then an Archimedean spiral stroked in a lighter swirl color. This matches the spiral rose in your reference.
• Daisy: 9 elliptical petals plus a yellow center.
5.5 Determinism. The generator uses a seeded PRNG (mulberry32). Same seed gives the same garden, which makes bugs reproducible and enables sharing. Add ?seed=1234 support:
const seed = +new URLSearchParams(location.search).get('seed') || Date.now();
garden.build(boxOfClock(), seed);
5.6 Ideas to tune the look
• Thicker, tapered vines: draw segments with decreasing lineWidth.
• Hand-drawn feel: add a small random jitter to each point at draw time.
• Branches: at 5 percent of points, spawn a short child vine.
• Butterfly (in your reference): a small sprite that follows a sine path across the scene.
Acceptance
• Vines never cover the digits.
• Regrow takes under 50 ms to generate on desktop.
• The same seed reproduces the same garden.
Phase 6. Weather FX Layer
A second canvas (#fx) sits above the garden with pointer-events: none.
Kind
Effect
Notes
clear day
Warm radial sun glow top right, floating pollen
Pollen drifts right with sine bob
clear night
Twinkling stars
Alpha follows abs(sin(t + phase))
cloud
Large soft radial-gradient blobs drifting right
Blob count 7, speed varies per cloud
fog
Very large low-alpha blobs in the lower 70 percent
Day and night alpha differ
rain
230 slanted streaks
Slant follows wind speed
storm
340 streaks plus lightning
White flash every 3 to 9 s, fades in 0.33 s
snow
150 flakes, sine drift
Soft shadow so flakes read on white
Wind coupling. wind km/h / 12 multiplies garden sway, and wind * 0.25 is the rain and snow slant.
Particle budget. Cap at about 340 particles. Reduce by half on devices with navigator.hardwareConcurrency <= 4.
Acceptance. Every dropdown value in the simulator renders correctly in every theme, with no frame drops.
Phase 7. Themes and Auto-Theme
7.1 Theme schema
{ name, bg, stage, vine, leaf, flowers:[...], swirl, bloom:'rose'|'daisy',
  digit, glow, ui, panel, glass?:true, neon?:true }
7.2 Included themes
Key
Look
noir
Black, blue vines, red spiral roses (your reference)
glass
White room, glass marble panel, multicolor roses
sakura
Dark plum, green vines, pink daisies
neon
Near black, cyan glowing vines, magenta and violet roses
sunset
Purple to orange gradient, gold vines
forest
Deep green, yellow and orange daisies
7.3 Auto rules
if (!isDay) return rain||storm ? 'noir' : 'neon';
if (rain||storm) return 'noir';
if (snow) return 'glass';
if (fog) return 'forest';
if (hour >= 17 || hour < 7) return 'sunset';
return clear ? 'glass' : 'sakura';
7.4 Glass marble theme. #stage gets an inset margin, a 32 px radius, a white inner border, and an overlay .sheen with two gradients. The canvas sits inside, so the garden looks trapped in glass, as in your first image prompt.
7.5 Adding a new theme. Add one object to THEMES. The dropdown, CSS variables and canvas painter pick it up automatically.
7.6 Smooth transitions. CSS handles background and color fades (0.8 s). The garden regrows on theme change, which acts as a visible transition.
Acceptance. All themes pass a contrast check (digits against background at least 4.5:1, except the decorative glow). Auto switches correctly under each simulated weather.
Phase 8. UI/UX, Responsive and Accessibility
8.1 Controls bar. City, Theme, Simulate, 12h, sec, regrow, sync status. On phones it wraps and shrinks (@media (max-width: 640px)).
8.2 Responsive digits. font-size: clamp(70px, 21vw, 300px). The garden is rebuilt after a resize, debounced at 150 ms.
8.3 Kiosk mode (nice for a desk display). Press F for fullscreen and H to hide the controls:
addEventListener('keydown', e => {
  if (e.key === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  if (e.key === 'h') document.querySelector('#controls').classList.toggle('hidden');
});
#controls.hidden{display:none}
8.4 Accessibility checklist
• aria-live="off" on the time (screen readers should not announce every second).
• A visually hidden <h1>Garden Clock</h1>.
• Labels on all controls, and keyboard focus rings visible.
• prefers-reduced-motion: skip growth animation, disable sway, and show only calm effects:
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
// in Garden: if (reduce) e = 1 (fully grown), wind = 0
// in FX: lower particle counts, disable lightning flash
• prefers-color-scheme: when theme is Auto and there is no weather yet, use noir for dark and glass for light.
Acceptance. Lighthouse Accessibility is 95 or higher. The app works with keyboard only. Reduced motion is respected.
Phase 9. Performance
9.1 Budget
• 60 fps on desktop, 30+ fps on a 4-year-old phone.
• Main-thread frame cost under 6 ms.
9.2 Optimizations, in order of payoff
1. Cap devicePixelRatio at 2 (done).
2. Pause the loop when the tab is hidden:
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); }
});
3. After the garden finishes growing (P = 1), render it once to an offscreen canvas and only redraw the swaying parts. This cuts per-frame work a lot.
4. Drop to 30 fps for fog and cloud themes (their motion is slow).
5. Skip shadowBlur on low-power devices, since it is the most expensive canvas call.
6. Use OffscreenCanvas in a Worker for the FX layer (advanced).
9.3 Measuring. Chrome DevTools Performance panel, the FPS meter, and performance.measure() around garden.draw and fx.draw.
9.4 Network. Preconnect to fonts and the APIs, cache weather for 10 minutes, and use one request per refresh.
Acceptance. Lighthouse Performance is 90 or higher on mobile emulation. Idle CPU stays low in a background tab.
Phase 10. Testing
10.1 Unit tests (Vitest)
// tests/unit/weather.test.js
import { describe, it, expect } from 'vitest';
import { kindOf } from '../../js/weather.js';

describe('kindOf', () => {
  it.each([[0,'clear'],[3,'cloud'],[45,'fog'],[61,'rain'],[73,'snow'],[95,'storm']])('%i -> %s', (c, k) => {
    expect(kindOf(c)).toBe(k);
  });
});
// tests/unit/themes.test.js
import { it, expect } from 'vitest';
import { autoTheme, THEMES } from '../../js/themes.js';
it('night + clear is neon', () => expect(autoTheme('clear', false, 23)).toBe('neon'));
it('every auto result exists', () => {
  for (const k of ['clear','cloud','fog','rain','storm','snow'])
    for (const d of [true,false]) for (const h of [3,12,18])
      expect(THEMES[autoTheme(k,d,h)]).toBeDefined();
});
// tests/unit/garden.test.js (determinism)
import { it, expect } from 'vitest';
import { Garden } from '../../js/garden.js';
const fake = () => ({ getContext: () => ({}), getBoundingClientRect: () => ({ width: 800, height: 600 }) });
it('same seed gives same garden', () => {
  const a = new Garden(fake()), b = new Garden(fake());
  a.W = b.W = 800; a.H = b.H = 600;
  const box = { x: 300, y: 250, w: 200, h: 100 };
  a.build(box, 42); b.build(box, 42);
  expect(a.vines.length).toBe(b.vines.length);
  expect(a.vines[0].pts[5]).toEqual(b.vines[0].pts[5]);
});
Set the Vitest environment to jsdom in vite.config.js (test: { environment: 'jsdom' }).
10.2 Time sync test. Mock fetch to return a known utc_datetime and assert that now() moves by the expected offset.
10.3 E2E (Playwright), with mocked network so tests are stable
// tests/e2e/app.spec.js
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {
    timezone: 'Asia/Kolkata',
    current: { temperature_2m: 31, relative_humidity_2m: 70, weather_code: 61, wind_speed_10m: 12, is_day: 1 } } }));
  await page.route('**/worldtimeapi.org/**', r => r.fulfill({ json: { utc_datetime: new Date().toISOString() } }));
});

test('shows clock and weather', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#hh')).toHaveText(/\d\d/);
  await expect(page.locator('#w-temp')).toHaveText('31°C');
  await expect(page.locator('#w-desc')).toContainText('Light rain');
});

test('theme switch', async ({ page }) => {
  await page.goto('/');
  await page.selectOption('#theme', 'glass');
  await expect(page.locator('body')).toHaveClass(/glass/);
});

test('simulate storm renders without errors', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e));
  await page.goto('/');
  await page.selectOption('#sim', 'storm');
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
playwright.config.js:
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  webServer: { command: 'npm run build && npm run preview -- --port 4173', port: 4173, reuseExistingServer: true },
  use: { baseURL: 'http://localhost:4173' },
});
10.4 Visual regression. Use ?seed=1 plus expect(page).toHaveScreenshot() for each theme and each simulated weather (6 x 6 matrix). Freeze the clock with page.clock.install({ time: new Date('2026-10-27T11:30:00') }).
10.5 Manual QA matrix
Device
Browsers
Desktop 1080p and 4K
Chrome, Firefox
Android mid-range
Chrome
iPhone
Safari
Tablet landscape
Safari, Chrome
Acceptance. npm test and npm run e2e are green, with no console errors in any theme or weather.
Phase 11. PWA and Offline
11.1 vite.config.js
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  test: { environment: 'jsdom' },
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Garden Clock', short_name: 'GardenClock',
      theme_color: '#000000', background_color: '#000000',
      display: 'fullscreen', orientation: 'any',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    },
    workbox: {
      runtimeCaching: [
        { urlPattern: /fonts\.(googleapis|gstatic)\.com/, handler: 'StaleWhileRevalidate', options: { cacheName: 'fonts' } }
      ]
    }
  })]
});
11.2 Behavior offline. App shell loads from cache, the clock runs on the last known offset, weather shows the last cached reading with the "offline" tag, and the garden and FX are fully local.
11.3 Wake lock for desk use (optional). Keep the screen on while the clock is visible:
let lock; async function keepAwake(){ try{ lock = await navigator.wakeLock.request('screen'); }catch{} }
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
keepAwake();
Acceptance. Lighthouse PWA checks pass, the app installs on Android and desktop, and it opens with no network.
Phase 12. CI/CD and Deployment
12.1 GitHub Actions: .github/workflows/ci.yml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist }
12.2 Option A: Vercel (simplest)
npm i -g vercel
vercel link
vercel --prod
In the Vercel dashboard, connect the GitHub repo. Framework: Vite. Build: npm run build. Output: dist. Every pull request gets a preview URL.
12.3 Option B: Docker + nginx (self-hosted, fits your KVM servers)
Dockerfile:
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
nginx.conf:
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / { try_files $uri /index.html; }
  location ~* \.(js|css|png|svg|woff2)$ { expires 30d; add_header Cache-Control "public, immutable"; }
  add_header X-Content-Type-Options nosniff;
  add_header Referrer-Policy strict-origin-when-cross-origin;
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; connect-src https://api.open-meteo.com https://geocoding-api.open-meteo.com https://worldtimeapi.org; img-src 'self' data:";
}
docker-compose.yml:
services:
  garden-clock:
    build: .
    ports: ["8080:80"]
    restart: unless-stopped
docker compose up -d --build
Put Caddy or Traefik in front for HTTPS. Geolocation and service workers require HTTPS.
12.4 Option C: GitHub Pages. Add base: '/garden-clock/' to vite.config.js and use the actions/deploy-pages workflow.
12.5 Domain. Add an A or CNAME record, enable HTTPS, then test geolocation and PWA install on the real domain.
Acceptance. A push to main runs CI and deploys. A pull request gets a preview. The production site loads over HTTPS.
Phase 13. Monitoring and Release
• Privacy-friendly analytics: Plausible or Umami (self-hostable on your server). Track theme choice and weather kind only. No personal data.
• Error tracking: a small window.onerror and unhandledrejection handler that posts to Sentry or a webhook.
• Uptime: UptimeRobot or your existing monitoring on the URL.
• API health: log when Open-Meteo or worldtimeapi calls fail, so you can add a fallback API.
• Versioning: semantic versions. Run npm version minor && git push --follow-tags.
• Changelog: keep CHANGELOG.md using the conventional commit history.
Release checklist
1. All tests green on main.
2. Lighthouse 90+ (performance, accessibility, best practices, PWA).
3. Manual QA on the device matrix.
4. Tag, deploy, smoke-test the live URL.
5. Post screenshots or a screen recording (your LinkedIn reference is a good format).
Phase 14. v2 Roadmap
Idea
Description
Difficulty
Idle garden growth
The garden keeps growing while the tab is closed. On return, show a report: new vines, new blooms. Store lastSeen and a seed in localStorage and fast-forward on load
Medium
Hourly forecast ring
A thin arc around the clock showing the next 12 hours of weather
Medium
Seasons
Flower types and palette follow the month (monsoon, winter)
Easy
Sound
Soft rain, wind and birds with WebAudio. Off by default
Medium
Butterflies and bees
Sprites that visit flowers, drawn from your reference
Easy
Moon phase and sunrise/sunset
Sky tint shifts using Open-Meteo daily=sunrise,sunset
Easy
Multi-city world clocks
Small garden tiles for 3 cities
Medium
Share a garden
?seed= link and a PNG export with canvas.toBlob
Easy
Interaction
Tap a flower to make petals fall, drag to push vines
Medium
WebGL renderer
Real glass refraction for the marble theme with a fragment shader
Hard
Device-adaptive world
Different garden by screen, DPR, input type and color scheme (your other concept)
Medium
Quick Reference
Daily loop
git switch -c feat/phase-N-name
npm run dev
# code, test in browser
npm run lint && npm test
git commit -m "feat: ..."
git push -u origin feat/phase-N-name
# open PR, wait for CI, merge, delete branch
Suggested 3-week schedule
Week
Phases
1
0, 1, 2, 3, 4, start 5
2
finish 5, 6, 7, 8
3
9, 10, 11, 12, 13, ship v1.0
Troubleshooting
Problem
Fix
Blank page when opening index.html
Use npm run dev. ES modules need http
Geolocation never asks
Needs HTTPS or localhost
Time off by seconds
Check that the sync label shows a recent time. The API may be blocked by a CSP or adblocker
Vines cover the digits
Increase pad in boxOfClock() and rebuild after fonts load
Garden looks different after resize
Expected: it regrows with a new seed. Pass ?seed= to keep it fixed
Low fps on phone
Lower particle counts, disable shadowBlur, apply Phase 9 step 3
CORS error on time API
Switch to a second provider and keep the local clock as the final fallback
Troubleshooting
Problem
Fix
Blank page when opening index.html
Use npm run dev. ES modules need http
Geolocation never asks
Needs HTTPS or localhost
Time off by seconds
Check that the sync label shows a recent time. The API may be blocked by a CSP or adblocker
Vines cover the digits
Increase pad in boxOfClock() and rebuild after fonts load
Garden looks different after resize
Expected: it regrows with a new seed. Pass ?seed= to keep it fixed
Low fps on phone
Lower particle counts, disable shadowBlur, apply Phase 9 step 3
CORS error on time API
Switch to a second provider and keep the local clock as the final fallback
