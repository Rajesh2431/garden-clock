# Design Notes

## Art direction

The primary reference is a black field with royal-blue vines, pointed leaves and red spiral
roses. Vines enter from the top-left and top-right corners and the bottom-left. Rose clusters
sit to the left, right and bottom-right of the clock. A butterfly crosses the scene.

The clock remains the visual anchor: thin, light digits with a wide track, a short date line and
a small timezone label. Decoration stops at a padded box around the digits so the time is never
obscured.

The glass theme treats the scene as a marble: a light room, inset stage, rounded panel, white
rim, soft caustics and a translucent sheen over the flower colours.

## Layout

```text
+--------------------------------------------------+
| temperature, condition, place          (vines)    |
| (vines)                                           |
|                11 : 30  42                        |
|              TUE - 27 OCT 2026                    |
| (roses)          GMT+5:30             (roses)     |
| (vines)                                           |
| [city] [theme] [weather] [12h] [sec] [actions]    |
+--------------------------------------------------+
```

- The stage fills the viewport with `position: fixed`.
- The clock is centred with the weather panel in the top-right (top-left on narrow screens).
- The controls sit at the bottom, wrap on small screens and can be hidden with `H` or `?kiosk=1`.
- The clock box is padded by 4% of the smaller viewport dimension, with a 16px minimum. The
  procedural vines are clipped against this box.

## Tokens

Design tokens are CSS custom properties set by `applyTheme`:

| Token        | Purpose                                        |
| ------------ | ---------------------------------------------- |
| `--bg`       | Page background                                |
| `--stage-bg` | Canvas-stage background                        |
| `--digit`    | Clock digits                                   |
| `--glow`     | Optional digit glow                            |
| `--ui`       | Primary UI text                                |
| `--muted`    | Secondary text                                 |
| `--panel`    | Control and weather panel fill                 |
| `--border`   | Panel border                                   |
| `--accent`   | Focus rings, links, small accents              |
| `--rose`     | Decorative accent                              |
| `--inset`    | Stage inset (used by the glass marble)         |
| `--radius`   | Stage corner radius (used by the glass marble) |
| `--font`     | Outfit with system-ui fallback                 |

Colours are also mirrored in JavaScript because the canvas cannot read CSS variables during a
draw pass. `THEMES` is the single source of truth for the canvas; `applyTheme` writes the same
values into CSS.

## Themes

| Key      | Background        | Vines / leaves | Flowers                   | Bloom |
| -------- | ----------------- | -------------- | ------------------------- | ----- |
| `noir`   | Black             | Royal blue     | Red spiral roses          | Rose  |
| `glass`  | White / cool grey | Bright blue    | Multicolour roses         | Rose  |
| `sakura` | Dark plum         | Green          | Pink daisies              | Daisy |
| `neon`   | Near black        | Cyan           | Magenta, violet and green | Rose  |
| `sunset` | Purple-orange     | Gold           | Coral and amber roses     | Rose  |
| `forest` | Deep green        | Olive          | Yellow and orange daisies | Daisy |

Auto rules, in order:

1. Night with rain or storm: noir.
2. Night otherwise: neon.
3. Day with rain or storm: noir.
4. Snow: glass.
5. Fog: forest.
6. Dawn or dusk (before 07:00 or from 17:00): sunset.
7. Clear day: glass.
8. Anything else: sakura.

Before the first weather response, Auto uses the system colour scheme: noir for dark, glass for
light.

## Typography

- Family: Outfit, weights 200-500, with a system sans-serif fallback.
- Digits: weight 200, responsive `clamp()` sizing, tabular numerals.
- Date and timezone: small uppercase labels with letter spacing.
- Controls: compact 12-14px labels so the garden remains the dominant element.

## Motion

- Garden growth: seven seconds with per-vine delays and ease-out cubic.
- Flowers scale in when their vine reaches them.
- Leaves sway with a sine wave; wind speed scales the amplitude.
- Flowers pulse by roughly 3%.
- Weather FX use a 30fps target for slow effects and a lower frame rate for fog and cloud.
- Theme changes fade CSS colours over 0.8s; the canvas regrows.
- Reduced motion skips growth, disables sway and lightning, removes butterflies and lowers
  particle counts.

## Accessibility

- The clock is a `role="timer"` with `aria-live="off"`.
- All icon-only buttons have accessible names and tooltips.
- Focus rings are visible on every control; the skip link jumps to city search.
- Text contrast for digits is checked at 4.5:1 or better per theme.
- The canvas layers are `aria-hidden`; the weather and control text carry the meaning.
- The app remains usable at 360px width and in a 4K full-screen window.
