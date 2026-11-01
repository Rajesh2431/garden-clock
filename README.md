# Garden Clock

A full-screen live clock whose digits sit inside a procedural garden. Vines grow in from the edges, roses and daisies bloom around the clock, and the garden follows the real weather and time of day for the selected city.

The reference look is black, royal-blue vines and red spiral roses. Nine more themes are included, along with a seasonal flower mix, a sky of sun, moon and stars, and a weather simulator for demos and tests.

## Features

- Live clock with seconds, 12/24-hour mode and the selected city's IANA timezone.
- Latency-compensated internet time sync, with a Cloudflare timestamp fallback and a final local-clock fallback.
- Live weather from Open-Meteo with no API key: clear, cloudy, fog, drizzle, rain, thunderstorm, snow, day and night.
- Procedural garden: tapered vines, pointed leaves, nine flower species, flower clusters, butterflies and idle wind sway.
- Ten themes plus Auto, which follows weather and time of day (and the clock alone while weather is unavailable).
- Seasons: spring, summer, autumn and winter flower mixes, chosen automatically from the city's date and hemisphere or set by hand.
- Sky layer: sun by time of day, a seeded star field, the date's zodiac constellation with a highlighted star, and the real moon phase.
- Weather FX layer: pollen, clouds, fog, drizzle, rain, lightning and snow.
- A garden that keeps growing: a new short vine every 18 seconds (up to 28), saved per seed and caught up after time away.
- Click or tap anywhere to bloom a flower and call a butterfly. The **Bloom** button (or `B`) opens a burst of five to seven flowers along the vines without replacing the garden. Clicked blooms survive theme, season and resize changes.
- Runs on any device: three quality tiers chosen from the hardware, with an automatic step-down when the frame rate drops.
- City search and browser geolocation.
- Seeded gardens, share links and PNG export.
- Reduced-motion support, keyboard shortcuts, kiosk mode and optional screen wake lock.
- Installable PWA with an offline app shell and cached weather.
- Unit, browser and build checks in GitHub Actions.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer
- A modern browser with Canvas 2D and ES modules

## Quick start

```bash
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

```bash
npm run build
npm run preview
```

The production build is written to `dist/`.

## Scripts

| Command                | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Start the Vite development server                           |
| `npm run build`        | Build the production site and service worker                |
| `npm run preview`      | Serve the production build locally                          |
| `npm test`             | Run the Vitest unit tests                                   |
| `npm run test:watch`   | Run unit tests in watch mode                                |
| `npm run e2e`          | Build, preview and run the Playwright browser tests         |
| `npm run lint`         | Run ESLint                                                  |
| `npm run lint:fix`     | Run ESLint with automatic fixes                             |
| `npm run format`       | Format the repository with Prettier                         |
| `npm run format:check` | Check formatting without writing files                      |
| `npm run assets`       | Regenerate the PNG icons from `scripts/art/icon.svg`        |
| `npm run og`           | Capture a real browser screenshot and write `public/og.png` |

`npm run assets` needs `rsvg-convert` and ImageMagick's `magick`. `npm run og` and
`npm run e2e` need Playwright's Chromium (`npx playwright install chromium`).

## URL parameters

| Parameter    | Effect                                                                   |
| ------------ | ------------------------------------------------------------------------ |
| `?seed=1234` | Reproduce a specific garden. Seeds are positive 32-bit integers.         |
| `?regrow=1`  | Generate a new seed on load, then remove this parameter from the URL.    |
| `?quality=…` | Pin a quality tier: `high`, `medium` or `low`. Turns off auto step-down. |
| `?kiosk=1`   | Hide the controls on load. Press `H` to show them again.                 |
| `?debug=1`   | Show frame timing, seed, weather kind and particle counts.               |

The current seed is written back to the URL when a garden is shared. The Bloom button never
changes the seed; a brand-new garden comes from `?regrow=1` or the installed app's "New garden"
shortcut.

## How it works

### Time

`js/clock.js` uses an NTP-lite estimate. It records a monotonic start time, fetches an
authoritative UTC timestamp, records the end time, and assumes the server timestamp was taken
at the midpoint of the request:

```text
offset = serverTime + roundTrip / 2 - localTime
```

Three samples are taken and the lowest-round-trip sample wins. The clock resyncs every ten
minutes, after a tab has been hidden longer than the interval, and when the browser comes back
online. Time sources, in order:

1. `timeapi.io` - UTC timestamp with a zoneless `dateTime` field, treated as UTC.
2. `https://cloudflare.com/cdn-cgi/trace` - the `ts` field, in seconds, parsed as UTC.
3. The browser clock, announced as `Local clock` in the UI.

Formatting uses `Intl.DateTimeFormat` with the IANA zone returned by Open-Meteo, so daylight
saving time is handled by the browser rather than by hard-coded offsets.

### Weather

`js/weather.js` requests current conditions and daily sunrise/sunset from Open-Meteo. Location
comes from the saved city, then browser geolocation, then Chennai as the default. WMO weather
codes are grouped into seven visual kinds; unknown codes fall back to cloudy.

Weather is cached in `localStorage` for ten minutes. A stale cached reading is shown with an
`Offline` label when a refresh fails. The production service worker also caches recent Open-Meteo
responses as a second line of defence.

### Garden

`js/garden.js` uses a seeded `mulberry32` PRNG. Vines start on an edge, wander with a sine
wobble, steer toward the clock and stop when they enter a padded box around the digits. Leaves
and flowers are attached along each vine. Rose clusters are placed to the left, right and
bottom-right of the clock, and one or two butterflies follow slow sine paths.

The same seed and viewport produce the same garden. Changing theme or weather does not change
the geometry; `?regrow=1` creates a new seed and updates `?seed=`. The garden is rebuilt after
resize and after web fonts load. A rebuild with the same seed and layout keeps the garden's age,
so a theme or season change recolours it without replaying the growth animation. Clicked blooms
are kept for the same seed and move proportionally after a resize.

Every 18 seconds `growOne()` adds a short edge vine with one or two flowers, seeded by the garden
seed and the growth index, up to 28 extra vines. The count is stored in `localStorage` per seed,
and time spent away (a closed or hidden tab) adds one vine per 20 minutes, up to four at a time.

### Seasons and sky

`js/almanac.js` holds pure helpers: time-of-day phase (morning 05–12, afternoon 12–17, evening
17–21, night), meteorological seasons flipped for the southern hemisphere, the moon phase from
the synodic month, and the zodiac constellation for the date with one "star of the day". Dates
are taken from the selected city's wall clock (`wallDate()` in `js/clock.js`), so the season and
constellation change at local midnight rather than UTC midnight.

`js/sky.js` draws the bottom canvas: the sun for day phases, and the star field, constellation
and moon for evening and night, dimmed by cloud, rain, fog and snow. Choosing one of the four
time themes (Morning Dew, Afternoon Sun, Evening Glow, Starry Night) also sets the sky phase.

### Themes and FX

`js/themes.js` contains ten palettes and the Auto rules. Theme changes write CSS custom
properties, update the meta theme colour and rebuild the canvas. Digits are checked against
their background at 4.5:1 or better. A first visit starts on Auto; choose Noir Roses for the
black, blue and red reference look. Auto uses Noir Roses for rain, drizzle and storms, Glass
Marble for snow, Forest for fog, and the time themes otherwise. Until weather arrives, or if it
fails, Auto follows the local hour on its own.

`js/fx.js` draws a separate canvas above the garden. Particle counts are capped at 340 and
scaled by the quality tier. Reduced motion lowers the counts further, removes butterflies,
disables lightning and skips growth animation. The garden stops animating in a hidden tab.

### Quality tiers

`js/quality.js` picks a starting tier and watches the frame rate.

| Tier   | Chosen for                                             | Pixel ratio | Particles / stars | Garden                                  |
| ------ | ------------------------------------------------------ | ----------- | ----------------- | --------------------------------------- |
| high   | Desktops and laptops with more than 4 cores and 4 GB   | up to 2     | 100% / 100%       | live: leaves sway, flowers pulse        |
| medium | Phones and tablets (touch), 4 cores or 4 GB, Save-Data | up to 1.5   | 60% / 75%         | one cached bitmap, redrawn up to 40 fps |
| low    | 2 cores or 2 GB, or any device that cannot keep up     | 1           | 35% / 50%         | one cached bitmap, redrawn up to 24 fps |

On every tier the butterflies, clicked blooms (while they open), weather and sky keep moving.
The sky is redrawn at most 30 times a second, since its twinkle is slow. After a six-second
warm-up, the governor checks the frame rate every three seconds. It steps down one tier after
two slow windows (below 40 fps on high, below 24 fps on medium), or after one window below half
of that target. It never steps back up in the same session. A step-down is remembered for a
week so the next visit starts at the right tier. `?quality=` pins a tier, and `?debug=1` shows
the tier, the pixel ratio and both the drawn and `requestAnimationFrame` frame rates.

With reduced motion, a settled garden and sky are not redrawn at all until something changes.

### PWA and offline

`vite-plugin-pwa` generates `manifest.webmanifest`, `sw.js` and `registerSW.js`. The app shell
and local assets are precached. Google Fonts, Open-Meteo and timeapi responses use runtime
caching. Service worker registration is an external script, so the production CSP does not need
inline-script permission. `display` is `fullscreen`, and shortcuts open kiosk mode or grow a
garden.

## Configuration

All configuration is optional. Copy `.env.example` to `.env` if needed.

| Variable                  | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `VITE_BASE`               | Vite base path. Use `/repo-name/` for a GitHub Pages project site.        |
| `VITE_ANALYTICS_ENDPOINT` | Optional analytics collector. Sends theme/weather events, no coordinates. |
| `VITE_ERROR_ENDPOINT`     | Optional error collector. Sends message, source, line and stack.          |

Builds on Vercel (where `VERCEL=1`) also inject Vercel Web Analytics and Speed Insights. Both
load from the same origin, so the CSP needs no change. Local, Docker and Pages builds leave them
out.

If you enable either endpoint, add its origin to the `connect-src` directive in the CSP used by
your host (`nginx.conf` and `vercel.json`). The default CSP allows only self, Google Fonts,
Open-Meteo, timeapi.io and Cloudflare.

## Deployment

### Vercel

Import the repository in Vercel. The included `vercel.json` sets the Vite framework, build
command and output directory, security headers and cache policy. Every pull request gets a
preview deployment.

### Docker and nginx

```bash
docker compose up -d --build
# http://localhost:8080
```

Or with plain Docker:

```bash
docker build -t garden-clock .
docker run --rm -p 8080:80 garden-clock
```

The image builds with Node 22, serves the static site with nginx and includes a health check.
`nginx.conf` adds CSP and security headers, long-lived caching for hashed assets, no-cache
headers for the service worker and manifest, and SPA fallback. Put the container behind Caddy,
Traefik or another TLS terminator for a public deployment. Geolocation, the wake lock and
service workers require a secure context; `localhost` is treated as secure during development.

### GitHub Pages

Run the **GitHub Pages** workflow manually from the Actions tab. Set the base path to
`/garden-clock/` for a project site, or `/` for a user or organization site. The workflow builds
with that base and publishes `dist`.

### Other hosts

Any static host works. Serve `dist/`, set the base path at build time if the site is not at the
domain root, and mirror the cache headers from `nginx.conf` or `vercel.json`. Do not cache
`sw.js` or `registerSW.js`; hashed files under `/assets/` can be cached indefinitely.

See [docs/DEPLOY.md](docs/DEPLOY.md) for the full deployment guide, including CSP changes for
optional endpoints.

## Testing and CI

```bash
npm run format:check
npm run lint
npm test
npm run e2e
npm run build
```

The test suite covers time parsing and offset estimation, weather mapping, cache fallbacks,
geolocation, theme rules and contrast, seeded garden geometry, FX particle budgets and the main
browser flows. The Playwright suite mocks all external APIs, blocks service workers and uses
reduced motion so results are deterministic.

GitHub Actions runs formatting, linting, unit tests, browser tests and the production build on
every push and pull request. A manual Pages workflow and a tagged container publication workflow
are included.

## Project layout

```text
index.html                 markup, metadata, accessible labels
css/style.css              layout, themes, glass treatment, motion preferences
js/main.js                 state, UI wiring, sync/weather refresh, growth, share
js/export.js               PNG export (flattens canvases, redraws clock text)
js/clock.js                time parsers, NTP-lite sync, timezone formatting, wallDate
js/weather.js              Open-Meteo, geocoding, WMO mapping, cache
js/almanac.js              phases, seasons, moon phase, zodiac constellations
js/sky.js                  sun, star field, constellation and moon canvas
js/garden.js               seeded vines, flowers, clusters, butterflies, idle growth
js/fx.js                   weather particles and lightning
js/themes.js               palettes, contrast helpers, Auto rules
scripts/generate-assets.sh icon rasterisation
scripts/capture-og.mjs     reproducible Open Graph screenshot
scripts/visual-check.mjs   screenshots of every theme/season (needs `npm run preview`)
tests/unit/                Vitest suites
tests/e2e/                 Playwright suite
docs/                      design, research, deployment and acceptance notes
```

Further documentation:

- [Design notes](docs/DESIGN.md)
- [Research and API decisions](docs/RESEARCH.md)
- [Deployment guide](docs/DEPLOY.md)
- [Acceptance record](docs/ACCEPTANCE.md)

## Accessibility and performance

- The timer has `aria-live="off"` and is marked as a timer, so screen readers do not announce
  every second.
- Every control has a visible label or an accessible name, and focus rings are kept.
- Reduced motion removes growth, disables lightning and lowers particle counts.
- Auto follows the local hour before weather arrives, so the palette always matches the time.
- Season, sky and theme checks run once a minute rather than on every clock tick.
- Quality tiers cap the pixel ratio (2 / 1.5 / 1), bound the particle counts and cache the
  garden on phones and slower machines. Animation pauses when the tab is hidden.
- In a CPU-throttled Chromium test (4× slower, phone viewport) the medium tier holds about
  59 fps, against 10 fps for the full-detail tier.
- The production build is roughly 74 KB of JavaScript (26 KB gzip) and 13 KB of CSS.

## Privacy

The app has no backend and uses no API keys. Coordinates stay in the browser except when sent to
Open-Meteo for a forecast. The chosen city and last weather reading are stored in `localStorage`.
The optional analytics and error endpoints are disabled unless configured; when enabled, events
carry UI state only (theme, weather kind, season, flower species, seed and growth count), never
coordinates or city names. Vercel Analytics runs only on Vercel builds. Cloudflare's trace
endpoint is contacted only if the primary time API fails.

## License

MIT. See [LICENSE](LICENSE).
