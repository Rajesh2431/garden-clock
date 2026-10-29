# Research Notes

Date: 2026-10-27

## Constraints

- Vanilla JavaScript, Canvas 2D and Vite.
- No API keys, accounts or backend.
- Time and weather must work in the browser under normal CORS rules.
- The production build must work on a static host and as an installable PWA.
- The visual target is the supplied black / royal-blue / red-rose reference.

## Time source

`Date.now()` can be wrong by seconds or minutes on a device with a bad clock. The design uses a
latency-compensated offset from an internet time source and falls back to the local clock.

| Option                                            | Result                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `worldtimeapi.org`                                | Returned usable JSON in earlier trials, but connections reset repeatedly during this build. Not used.           |
| `timeapi.io`                                      | Stable HTTPS JSON endpoint with a UTC `dateTime` field. Works cross-origin. Chosen as primary.                  |
| Cloudflare `https://cloudflare.com/cdn-cgi/trace` | Plain-text `ts=` field with a Unix timestamp and permissive CORS. Chosen as fallback.                           |
| HTTP `Date` header from a third party             | The browser does not expose arbitrary response headers cross-origin unless CORS allows it. Not reliable enough. |
| Browser clock                                     | Final fallback, clearly labelled as local.                                                                      |

timeapi.io returns a `dateTime` without a timezone suffix, for example
`2026-10-26T20:19:16.0621867`. Treating that string directly as local time would shift the clock
by the browser offset, so the parser appends `Z` when no offset is present. If the response is
an HTTP date or already has `Z` or `+hh:mm`, it is parsed as-is.

The NTP-lite estimator records `performance.now()` before and after the request, adds half the
round-trip to the server timestamp, then subtracts the local wall clock. Three samples are taken
per sync and the lowest-RTT sample is kept. This is not a replacement for a full NTP client, but
it removes most network asymmetry and request-delay error for a visual clock.

## Weather source

Open-Meteo is free for non-commercial use and needs no key. The app requests:

```text
https://api.open-meteo.com/v1/forecast
  ?latitude=...
  &longitude=...
  &current=temperature_2m,relative_humidity_2m,apparent_temperature,
           precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day
  &daily=sunrise,sunset
  &timezone=auto
```

The response provides the IANA timezone used by the clock, current conditions, day/night state
and sunrise/sunset strings in local time. Geocoding uses:

```text
https://geocoding-api.open-meteo.com/v1/search?name=...&count=5&language=en&format=json
```

WMO codes are grouped for rendering:

| Codes         | Visual kind |
| ------------- | ----------- |
| 0, 1          | clear       |
| 2, 3          | cloud       |
| 45, 48        | fog         |
| 51-67, 80-82  | rain        |
| 71-77, 85, 86 | snow        |
| 95-99         | storm       |

Unknown or missing codes fall back to cloud rather than claiming clear weather.

## Caching and failure handling

- Weather is cached for ten minutes in `localStorage`, keyed by a schema/version string.
- Cached readings are reused only for the same coordinates, with a small tolerance.
- If a refresh fails, the last reading is shown with `Offline · updated ...` and a retry button.
- The service worker uses `NetworkFirst` for weather, geocoding and time, and caches fonts.
- The time offset is kept in memory. The last successful offset is reused until the next sync;
  the UI says `Local clock` when no sync has succeeded.

## PWA

`vite-plugin-pwa` 2.x with Workbox 7 generates the manifest and service worker at build time.
Registration is injected as an external script (`injectRegister: 'script'`) rather than an inline
snippet, so a strict `script-src 'self'` policy works in production. `autoUpdate` and
`cleanupOutdatedCaches` keep old shells from persisting.

The manifest uses fullscreen display, maskable and regular 192/512 icons, an Apple touch icon,
and shortcuts for kiosk mode and regrowth. `og.png` is a real 1200x630 screenshot produced by
`scripts/capture-og.mjs`, not a mock-up.

## Visual research

The supplied references establish the key visual rules:

- Black background with a subtle radial stage light.
- Organic blue vines with pointed leaves, growing from corners and edges.
- Red flowers built from a lobed silhouette and a lighter spiral.
- Asymmetric clusters, not a symmetrical frame.
- Thin, airy clock digits with a lot of negative space.

The implementation keeps those rules in the default noir theme and adapts the geometry to a
light glass theme instead of recolouring the same dark composition. Daisies, butterflies and
smaller clusters add life without competing with the digits.

## Security and privacy

- No secrets or private keys exist in the client.
- Geolocation is requested only after a user action or the initial best-effort lookup, and the
  result stays in the browser except for coordinates sent to Open-Meteo.
- CSP restricts scripts to self, styles to self plus Google Fonts, connections to the three
  documented API hosts, and frames to none.
- Optional analytics and error endpoints are opt-in and documented; their origins must be added
  to the CSP by the deployer.
- The Cloudflare trace endpoint is only contacted when timeapi.io fails.

## References

- Open-Meteo forecast API: <https://open-meteo.com/en/docs>
- Open-Meteo geocoding API: <https://open-meteo.com/en/docs/geocoding-api>
- timeapi.io: <https://timeapi.io/>
- Cloudflare trace endpoint: <https://cloudflare.com/cdn-cgi/trace>
- Vite: <https://vite.dev/guide/>
- vite-plugin-pwa: <https://vite-pwa-org.netlify.app/>
- Workbox: <https://developer.chrome.com/docs/workbox/>
- WMO weather interpretation codes: <https://open-meteo.com/en/docs#weathervariables>
- WCAG contrast: <https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html>
