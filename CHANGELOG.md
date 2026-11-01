# Changelog

All notable changes to Garden Clock are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-02

### Added

- Four seasons with their own flower mixes (tulip, cosmos, sunflower, lotus, bell,
  chrysanthemum and camellia join rose and daisy), chosen from the city's date and hemisphere
  or set with the new Season selector.
- Sky layer (`js/sky.js`) with a time-of-day sun, a seeded star field, the date's zodiac
  constellation and star of the day, and the real moon phase.
- Pure almanac helpers (`js/almanac.js`) for phases, seasons, moon phase and constellations.
- Morning Dew, Afternoon Sun, Evening Glow and Starry Night time themes, used by Auto.
- Drizzle option in the weather simulator.
- Continuous growth: a short vine every 18 seconds up to 28, persisted per seed, with catch-up
  after time away.
- Click or tap to bloom a flower and summon a butterfly.
- Sky note in the weather card (phase, moon, constellation, season).
- `wallDate()` in `js/clock.js` for timezone-correct calendar dates.
- Vercel Web Analytics and Speed Insights on Vercel builds only.
- `scripts/visual-check.mjs` for screenshots of every theme and season.

### Changed

- PNG export moved from `js/main.js` to `js/export.js`.
- Rebuilding the same garden (theme, season, toggles) keeps its age instead of replaying the
  growth animation, and clicked blooms survive rebuilds and resizes.
- Season, sky and Auto-theme checks run once a minute instead of every second.
- `?regrow=1` now builds the garden once instead of twice.

### Fixed

- Auto theme followed the system colour scheme instead of the clock when weather was
  unavailable, which could show the morning palette at night.
- The lightning bolt jumped to a new position on every frame of a flash.
- F, H and R shortcuts were ignored while a button or checkbox had focus.
- Season and constellation used the UTC date instead of the city's local date.
- The sky note could end with a dangling separator.
- Clicked flower stems ignored the screen scale.
- The page title did not update when only the hour changed.
- `data-season` browser tests asserted the wrong element.

## [1.0.0] - 2026-10-29

### Added

- Full-screen live clock with 12/24-hour mode, optional seconds and IANA timezone support.
- NTP-lite time sync with three samples, lowest-RTT selection and a ten-minute resync.
- Cloudflare trace fallback and a clearly labelled local-clock fallback.
- Live Open-Meteo weather with day/night state, wind, humidity, sunrise and sunset.
- City search, browser geolocation and a saved-location fallback to Chennai.
- Ten-minute weather cache with stale-reading fallback, offline label and retry action.
- Procedural garden with tapered vines, leaves, spiral roses, daisies, clusters and butterflies.
- Seeded `mulberry32` geometry, reproducible `?seed=` links and sub-50ms desktop rebuilds.
- Six themes, Auto rules, digit contrast checks and theme persistence.
- Weather FX for sun, pollen, stars, clouds, fog, rain, thunderstorms and snow.
- Weather simulator and debug overlay.
- Responsive layout from 360px phones to large desktops, plus glass-marble styling.
- Keyboard shortcuts, kiosk mode, reduced-motion behaviour, skip link and accessible controls.
- Screen wake lock, share link, PNG export and hourly regrowth.
- Installable PWA with generated manifest, icons, offline app shell and runtime caches.
- Generated Open Graph image from a real browser capture.
- Unit tests, Playwright tests, ESLint, Prettier, Husky, lint-staged and CI.
- Vercel configuration, multi-stage Docker image, nginx configuration, Compose file, GHCR
  publication workflow and manual GitHub Pages workflow.
- README, design notes, research notes, deployment guide and acceptance record.

### Security

- Strict production CSP with external service-worker registration.
- `nosniff`, frame denial, referrer policy and permissions policy on self-hosted and Vercel
  deployments.
- No API keys, secrets or backend.

### Known limitations

- Lighthouse scores and the physical-device QA matrix still need to be recorded.
- Web-font availability depends on Google Fonts; the system font fallback remains usable offline.
