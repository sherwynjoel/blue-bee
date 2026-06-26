# @blue-bee/design-tokens

The canonical **Daylight** design tokens for Blue Bee — pure TypeScript constants (no React, no
platform imports) shared by the web console (Tailwind) and the Expo apps (`customer` / `owner` /
`driver`) so the look stays consistent across every surface.

This package is the machine-readable counterpart of [`docs/design/DESIGN-LANGUAGE.md`](../../docs/design/DESIGN-LANGUAGE.md)
(the prose system of record). The two must stay in lock-step.

## What's exported

```ts
import { tokens, light, dark, space, radius, fontSize, shadow, motion, tailwindPreset } from '@blue-bee/design-tokens';

tokens.color.light.primary; // '#0B5FFF'
tokens.color.dark.canvas;   // '#0A0E1A'
space[8];                   // 32  (8pt rhythm)
radius.pill;                // 999
fontSize.title1;            // { size: 28, lineHeight: 34, weight: 700, tracking: -0.02 }
shadow.e2;                  // '0 4px 12px rgba(10,37,64,.08)'
motion.durations.sheet;     // 400
```

- **`color.light` / `color.dark`** — semantic palette (canvas/subtle/surface/hairline, text 1–3,
  primary + tint, accent/success/warning/danger + tints).
- **`space`** — 8pt rhythm with 2/4px half-steps.
- **`radius`** — `xs … 2xl` + `pill`.
- **`fontSize`** — semantic type ramp (`display … caption`), each `{ size, lineHeight, weight, tracking }`.
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
