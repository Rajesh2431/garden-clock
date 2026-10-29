# Changelog

All notable changes to Garden Clock are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
