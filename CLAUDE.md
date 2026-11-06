# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Garden Clock: a full-screen live clock inside a procedurally grown Canvas 2D garden that reacts to real weather (Open-Meteo, no API key) and the selected city's local time. Vanilla JS ES modules, no framework, built with Vite and shipped as a PWA. Node >= 22.12 (see `.nvmrc`).

## Commands

```bash
npm ci
npm run dev            # Vite dev server on :5173
npm run build          # dist/ + service worker (vite-plugin-pwa)
npm run preview        # serve dist/ on :4173
npm test               # Vitest unit tests (jsdom), tests/unit/**/*.test.js
npx vitest run tests/unit/garden.test.js          # single file
npx vitest run -t "name of test"                  # single test by name
npm run e2e            # Playwright: builds, previews on :4173, runs tests/e2e (Chromium only)
npx playwright test -g "name of test"             # single e2e test
npm run lint           # ESLint over js, tests, scripts, configs
npm run format:check   # Prettier (singleQuote, printWidth 110, trailing commas)
```

- E2E and `npm run og` need `npx playwright install chromium`. `npm run assets` needs `rsvg-convert` and ImageMagick `magick`.
- `node scripts/visual-check.mjs [out-dir] [base-url]` takes screenshots against a running `npm run preview`.
- The husky pre-commit hook runs lint-staged (Prettier), `npm run lint` and `npm test`. CI (`.github/workflows/ci.yml`) runs format:check, lint, unit, e2e, then build.

## Architecture

`index.html` loads `js/main.js`, which is the only stateful orchestrator. Every other module in `js/` is either a pure helper (unit-tested) or a canvas renderer class that `main.js` drives.

- **main.js**: owns the global `state` object, DOM refs (`els`), `localStorage` wrapper (`store`, keys prefixed `garden-clock:`), URL params (`?seed`, `?regrow`, `?quality`, `?kiosk`, `?debug`), UI wiring, keyboard shortcuts, the timers (clock resync every 10 min, weather refresh, `growGarden()` every 18 s) and the single `requestAnimationFrame` loop (`frame()`).
- **Three stacked canvases**, each a class with its own `draw()`: `Sky` (`sky.js`, bottom: sun, stars, zodiac constellation, moon), `Garden` (`garden.js`, vines, leaves, flowers, butterflies, clicked blooms), `FX` (`fx.js`, top: pollen, cloud, fog, rain, lightning, snow). `frame()` redraws each layer only when its per-tier budget in `FRAME_BUDGET` (`quality.js`) has elapsed.
- **Quality tiers** (`quality.js`): `detectQuality()` picks high/medium/low from hardware hints; `FrameGovernor` steps down (never up) on sustained low fps, and the step-down is remembered for a week. Medium/low tiers render the garden as a cached bitmap. Renderers take `{ quality, reducedMotion }` in their constructor and must honour both.
- **Determinism**: the garden geometry comes from a seeded `mulberry32` (`rand.js`). Same seed + viewport gives the same garden. Theme, weather or season changes must recolour without changing geometry; a rebuild with the same seed and layout keeps the garden's age so growth doesn't replay. Vines are clipped against a padded box around the clock digits (`boxOfClock()` in main.js) so decoration never covers the time.
- **Time** (`clock.js`): NTP-lite offset from timeapi.io, then Cloudflare trace, then the local clock. Always use `now()` / `parts()` / `wallDate(tz)` rather than `Date.now()` for displayed time; dates (season, constellation) come from the city's wall clock, not UTC.
- **Weather** (`weather.js`): fetches Open-Meteo, maps WMO codes to seven visual kinds (`kindOf`), caches in `localStorage` for 10 min, shows stale data marked Offline on failure. Geocoding uses Open-Meteo's geocoding API.
- **Themes** (`themes.js`): `THEMES` is the single source of truth for colours. `applyTheme` mirrors them into CSS custom properties because canvases can't read CSS vars mid-draw. `themeForState` implements Auto (weather + time of day). Unit tests enforce digit contrast >= 4.5:1, so a new theme must pass `themeContrast`.
- **almanac.js**: pure date math: time phase, hemisphere-aware seasons, moon phase, zodiac constellation and star of the day.
- **export.js**: composes all layers plus the DOM clock into one canvas for PNG export. **monitor.js**: optional analytics/error POSTs (`VITE_ANALYTICS_ENDPOINT`, `VITE_ERROR_ENDPOINT`).

## Things to keep in sync

- **CSP**: any new external origin (API, analytics endpoint) must be added to `connect-src` in both `nginx.conf` and `vercel.json`. Service worker registration is an external script (`injectRegister: 'script'`) so the CSP stays free of inline scripts; don't add inline `<script>`.
- **Runtime caching** for external APIs lives in the `workbox.runtimeCaching` list in `vite.config.js`.
- `__VERCEL__` is a build-time define (true only on Vercel builds) that gates Vercel Analytics/Speed Insights.
- `VITE_BASE` sets the base path (e.g. `/garden-clock/` for GitHub Pages).
- E2E tests mock every network call with `page.route` (fonts, Open-Meteo, timeapi, Cloudflare), fix the time, and run with `reducedMotion: 'reduce'` and service workers blocked. New network calls need matching routes there.

## Docs

`README.md` covers features and behaviour in depth (tier table, growth rules, Auto theme rules). `docs/DESIGN.md` covers art direction, layout and tokens, `docs/DEPLOY.md` covers Vercel/Docker/Pages, and `docs/ACCEPTANCE.md` records verification results, including a 60 KB gzip budget for the main JS bundle. `CHANGELOG.md` tracks releases.
