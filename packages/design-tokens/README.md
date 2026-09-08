# @blue-bee/design-tokens

The canonical **Daylight** design tokens for Blue Bee — pure TypeScript constants (no React, no
platform imports) shared by the web console (Tailwind) and the Expo apps (`customer` / `owner` /
`driver`) so the look stays consistent across every surface.

This package is the machine-readable counterpart of [`docs/design/DESIGN-LANGUAGE.md`](../../docs/design/DESIGN-LANGUAGE.md)
(the prose system of record). The two must stay in lock-step.

## What's exported

```ts
import { tokens, light, dark, space, radius, fontSize, shadow, motion, tailwindPreset } from '@blue-bee/design-tokens';

tokens.color.light.azure;  // '#1E50C8'  (brand primary — Royal Dry Cleaning crest blue)
tokens.color.light.honey;  // '#DDA82E'  (brand accent — Royal Dry Cleaning crown gold)
tokens.color.dark.canvas;  // '#0A0E1A'
space[8];                  // 32  (8pt rhythm)
radius.pill;               // 999
fontSize.title1;           // { size: 28, lineHeight: 34, weight: 700, tracking: -0.02 }
shadow.e2;                 // '0 4px 12px rgba(10,37,64,.08)'
motion.durations.sheet;    // 400
```

- **`color.light` / `color.dark`** — the Royal Dry Cleaning brand palette (canvas/subtle/surface/
  surfacePressed/hairline, text/textSecondary/textTertiary, `azure`+tint (brand primary), `honey`+tint
  (brand accent), success/warning/danger + tints, the `onAzure`/`onHoney` solid-fill foregrounds, the
  six `onXTint` pale-tint foregrounds, `scrim`, and `skeleton`/`skeletonHighlight`). Field names
  (`azure`/`honey`, not generic `primary`/`accent`) match what's already live in production across all
  three mobile apps.
- **`space`** — 8pt rhythm with 2/4px half-steps.
- **`radius`** — `xs … 2xl` + `pill`.
- **`fontSize`** — semantic type ramp (`display … caption`, plus `overline`), each
  `{ size, lineHeight, weight, tracking }`.
- **`shadow`** — elevation `e1…e3` + accessible `focus` ring.
- **`motion`** — `durations`, `easing` (CSS cubic-beziers), `spring` (RN/Reanimated).
- **`tailwindPreset`** — derived from the tokens; web can later do
  `presets: [require('@blue-bee/design-tokens').tailwindPreset]`.

## Scope note

This branch publishes the package + build + test only. **Wiring it into `apps/web` and the Expo apps
is a later reconciliation pass** (the reskin branches currently mirror these values locally).

## Develop

```bash
npm run -w @blue-bee/design-tokens build      # tsc -> dist
npm run -w @blue-bee/design-tokens test       # jest (token value assertions)
npm run -w @blue-bee/design-tokens typecheck
npm run -w @blue-bee/design-tokens lint
```
