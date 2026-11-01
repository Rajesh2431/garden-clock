# Acceptance Record

Last verified: 2026-10-29

## Scope

This record covers the v1 scope in `Project.md`: clock and time sync, live weather, procedural
garden, weather FX, themes, responsive UI, accessibility, performance safeguards, tests, PWA,
and deployment configuration.

## Automated checks

| Check                 | Command                 | Result                            |
| --------------------- | ----------------------- | --------------------------------- |
| Formatting            | `npm run format:check`  | Pass                              |
| Linting               | `npm run lint`          | Pass, no warnings                 |
| Unit tests            | `npm test`              | Pass, 99 tests in 6 files         |
| Browser tests         | `npm run e2e`           | Pass, 13 tests                    |
| Production build      | `npm run build`         | Pass, 18 precache entries         |
| Dependency audit      | `npm ci` in Docker      | 0 vulnerabilities reported by npm |
| Nginx syntax          | `nginx -t` in image     | Pass                              |
| Docker image          | `docker build`          | Pass                              |
| Compose configuration | `docker compose config` | Pass                              |
| Container health      | Docker health check     | Healthy                           |

Build output from the final verification:

```text
dist/registerSW.js               0.13 kB
dist/manifest.webmanifest        0.72 kB
dist/index.html                  7.64 kB | gzip:  2.31 kB
dist/assets/index-CbtbBjrx.css  11.58 kB | gzip:  3.53 kB
dist/assets/index-DlQQqQNc.js   44.02 kB | gzip: 16.34 kB
precache                         18 entries (497.55 KiB)
```

The main JavaScript bundle is below the 60 KB gzip budget at 16.34 kB gzip.

## Test coverage

Unit coverage includes:

- Time string parsing for timeapi.io, Cloudflare trace and HTTP dates.
- Offset estimation, lowest-RTT selection, provider fallback and local-clock fallback.
- Timezone formatting across Tokyo, London, New York and Kolkata, including DST.
- WMO code mapping and labels.
- Weather normalisation, geocoding, cache freshness, stale fallback and cross-location cache
  rejection.
- Geolocation success, denial, unavailability and timeout.
- Theme auto rules, theme selection, contrast ratios and DOM application.
- Seed determinism, canvas bounds, protected clock box, growth timing, wind clamping and
  resize behavior.
- FX particle budgets, low-power and reduced-motion behavior, rain bounds and render smoke tests.

Browser coverage includes:

- Clock, date, weather, sync status and Auto theme on load.
- Explicit theme and weather simulator independence.
- Every theme and every simulated weather condition, with page-error collection.
- 12-hour mode and seconds toggle.
- City search updating weather, timezone and clock.
- Bloom button (burst of flowers on the same garden) and `?regrow=1` for a new garden.
- PNG export.
- Cached-weather fallback and retry visibility.
- Local-clock fallback when time services fail.
- Keyboard hide/show shortcut.
- 360px mobile layout and horizontal overflow.
- Manifest, icons, service worker and OG asset availability.

## Deployment checks

- Multi-stage Docker build completed with Node 22 Alpine and nginx 1.27 Alpine.
- Container served the production build on port 80 and reported healthy.
- `nginx -t` passed inside the container.
- Root response included the CSP, `nosniff`, frame denial, referrer policy and permissions policy.
- `sw.js`, `registerSW.js` and `manifest.webmanifest` returned `Cache-Control: no-cache`.
- Hashed `/assets/` files returned a one-year `max-age`.
- A production Chromium run confirmed the service worker was active and an offline reload
  rendered the clock from the precached app shell.
- The offline run logged a failed Google Fonts request when the network was disabled; the app
  correctly used the local font fallback and continued to work.

## Manual visual checks

Screenshots were taken from the production nginx container at 1440x900 and 360x800:

- Noir Roses desktop and mobile: black field, royal-blue vines, red spiral roses, clusters at the
  left, right and bottom-right, and no flowers over the clock or date line.
- Glass Marble desktop: light stage, inset marble panel, multicolour roses and visible sheen.
- Auto theme on a clear daytime forecast: Glass Marble selected automatically.
- Thunderstorm simulation: rain streaks, lightning layer enabled and simulator badge visible.
- Weather panel is frosted and keeps the temperature, condition and metadata readable over vines.
- Mobile viewport had `document.scrollWidth === window.innerWidth === 360`.

## Requirement status

| Area                        | Status  | Notes                                                               |
| --------------------------- | ------- | ------------------------------------------------------------------- |
| Clock and timezones         | Met     | Multiple zones and DST tested; local fallback tested                |
| Internet time sync          | Met     | Three-sample NTP-lite, CF fallback; live timeapi/CF probes returned |
| Live weather                | Met     | Live Open-Meteo probe returned current conditions                   |
| Weather caching and offline | Met     | Unit and E2E fallback tests; production offline reload verified     |
| City search and geolocation | Met     | City flow E2E; geolocation states unit tested                       |
| Procedural garden           | Met     | Deterministic, bounded, rebuild under 50ms in unit test             |
| Weather FX                  | Met     | 6x6 theme/weather browser smoke test and particle budgets           |
| Themes and Auto             | Met     | Ten themes, contrast check and Auto rules tested                    |
| Responsive 360px to desktop | Met     | 360px E2E and 1440x900 visual check                                 |
| Accessibility               | Partial | Automated labels/reduced motion/contrast pass; Lighthouse pending   |
| Performance budgets         | Partial | JS gzip budget met; FPS and Lighthouse field scores not measured    |
| PWA install and offline     | Partial | Offline reload verified; real-device install pending                |
| CI/CD configuration         | Met     | CI, GHCR and Pages workflows added                                  |
| Vercel configuration        | Partial | `vercel.json` written; not deployed to Vercel in this environment   |
| Docker deployment           | Met     | Build, nginx, headers, health and offline run verified              |

## Remaining manual verification

These items require a real deployment or physical devices and are not claimed as verified:

1. Lighthouse Performance, Accessibility, Best Practices and PWA scores.
2. Time comparison against time.is within 300ms on a real device.
3. Install and launch on Android Chrome, iPhone Safari and desktop Chrome/Edge.
4. Firefox and Safari rendering, geolocation prompts and service-worker behavior.
5. 4K, tablet landscape and low-end phone frame-rate checks.
6. Vercel preview/production headers and deployment behavior.
7. A committed screenshot-regression baseline. The animated FX layer makes pixel snapshots
   time-dependent; the current test suite uses a full theme/weather smoke matrix plus manual
   captures instead.
