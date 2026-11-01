# Deployment Guide

## Build once, serve statically

```bash
npm ci
npm run format:check
npm run lint
npm test
npm run e2e
npm run build
```

`dist/` is a static site. It contains hashed assets, `index.html`, the manifest, icons, the
service worker, `registerSW.js`, `robots.txt` and `og.png`.

If the site is not served from the domain root, set `VITE_BASE` at build time:

```bash
VITE_BASE=/garden-clock/ npm run build
```

The base affects the asset URLs, manifest `start_url`, scope and PWA shortcuts. It does not
change the canonical origin, which you should add yourself if you use a custom domain.

## Vercel

1. Import the repository at <https://vercel.com/new>.
2. Framework preset: Vite.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Deploy.

`vercel.json` already provides these settings plus:

- CSP and security headers on every response.
- `Cache-Control` for hashed assets, the service worker and manifest.
- `Content-Type: application/manifest+json` for the manifest.

Pull requests get preview URLs automatically. No environment variables are required. Set
`VITE_BASE` only if serving from a subpath.

## Docker and nginx

```bash
docker compose up -d --build
docker compose ps
curl -I http://localhost:8080/
```

Or:

```bash
docker build -t garden-clock .
docker run --rm -p 8080:80 garden-clock
```

The multi-stage `Dockerfile` builds with Node 22 and copies `dist/` into
`nginx:1.27-alpine`. It exposes port 80 and has a health check that requests `/`.

Useful verification:

```bash
docker build -t garden-clock .
docker run --rm -d --name garden-clock-test -p 8080:80 garden-clock
curl -sSf http://localhost:8080/ >/dev/null
curl -sI http://localhost:8080/ | grep -i content-security-policy
curl -sI http://localhost:8080/sw.js | grep -i cache-control
curl -sI http://localhost:8080/assets/ | head
docker exec garden-clock-test nginx -t
docker rm -f garden-clock-test
```

`nginx.conf`:

- Serves `index.html` with no-cache semantics.
- Gives hashed files under `/assets/` a one-year cache lifetime.
- Gives images, icons and fonts a thirty-day cache lifetime.
- Sets `sw.js`, `registerSW.js` and the manifest to no-cache.
- Applies CSP, `nosniff`, frame denial, referrer policy and a restrictive permissions policy.
- Enables gzip for text, CSS, JavaScript, JSON, SVG and the manifest.
- Falls back to `index.html` for unknown paths.

Put the container behind a TLS terminator (Caddy, Traefik, nginx, a cloud load balancer) for a
public deployment. HTTPS is required for geolocation, the wake lock and service workers. During
local development, `localhost` is treated as a secure context.

## GitHub Pages

The `.github/workflows/pages.yml` workflow is manual:

1. Enable Pages in repository settings, source GitHub Actions.
2. Run **GitHub Pages** from the Actions tab.
3. Set the base input:
   - Project site: `/garden-clock/`
   - User or organization site: `/`

The workflow builds with that base, uploads `dist/`, and deploys with the official Pages
actions. Pages requires HTTPS for service workers; GitHub provides it automatically.

## Environment variables

| Variable                  | Default | Notes                                               |
| ------------------------- | ------- | --------------------------------------------------- |
| `VITE_BASE`               | `/`     | Build-time base path.                               |
| `VITE_ANALYTICS_ENDPOINT` | unset   | Optional; receives coarse theme/weather events.     |
| `VITE_ERROR_ENDPOINT`     | unset   | Optional; receives message, source, line and stack. |

If you configure either endpoint, update the CSP `connect-src` list in both `nginx.conf` and
`vercel.json` (and any other host) with the endpoint origin. A blocked endpoint otherwise logs a
CSP violation and the event is lost.

The analytics call is intentionally fire-and-forget and must not delay clock or garden work. Do
not send coordinates, city names or exact timestamps to third-party analytics.

## Cache and service-worker behavior

- The PWA precaches the app shell and local assets.
- `sw.js` must not be cached for long periods; otherwise clients can remain on an old worker.
- Hashed JS/CSS can be cached forever because their names change on each build.
- The manifest should be revalidated so install metadata and icons update.
- Workbox runtime caches keep Google Fonts, Open-Meteo, geocoding and timeapi responses. These
  caches are bounded by entry count and age.

After deploying, hard-reload once or close and reopen the installed PWA. `autoUpdate` activates a
new worker on the next load; `clientsClaim` and `skipWaiting` make the update immediate.

## Smoke test

```bash
curl -sSf https://your-domain/ >/dev/null
curl -sSf https://your-domain/manifest.webmanifest >/dev/null
curl -sSf https://your-domain/sw.js >/dev/null
curl -sSf https://your-domain/og.png >/dev/null
```

Then in a browser:

1. The clock shows the selected city's time and the correct date.
2. Weather resolves, or the cached/offline label appears.
3. Theme selection and all seven weather simulations render without console errors.
4. Regrow changes `?seed=` and the garden.
5. Share copies a URL; Save downloads a PNG.
6. The manifest is detected in DevTools and the app can be installed.
7. Offline reload shows the last shell and cached weather.
8. A 360px viewport has no horizontal overflow.

## Rollback

The site is immutable static output. Keep the previous `dist/` artifact or container image and
repoint the host. For Vercel, use the deployment history. For GHCR, deploy the previous image
tag. Service workers can lag one reload, so verify after reloading the installed app.
