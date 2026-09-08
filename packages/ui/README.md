# @blue-bee/ui — shared Daylight RN components

The shared React Native component library for the three Blue Bee Expo apps (customer / driver / owner).
It replaces driver+owner's duplicated `kit.tsx` and customer's overlapping `components/ui/*`, so every
app draws its primitives from one place. Colors/spacing/type come from `@blue-bee/design-tokens`
(colors) plus the RN-shaped scales here (type/space/radius/elevation/motion).

## What's here now

- **`useTheme()`** — the one hook every component uses. Reads `useColorScheme()` directly (no
  `<ThemeProvider>`, matching driver/owner), returns `{ scheme, isDark, colors, type, space, radius,
  elevation, motion, tabular, monoTabular, screenPadding, cardPadding }`. `colors` come from
  `@blue-bee/design-tokens` (the canonical Royal Dry Cleaning palette). Also: `buildTheme`,
  `lightTheme`, `darkTheme`, `usePressScale`, `useReducedMotion`, `toneColors`/`Tone`, `HIT_SLOP`,
  `MIN_TARGET`.
- **`haptics` / `fireHaptic(kind)` / `HapticKind`** — a swallow-errors wrapper over `expo-haptics`.
  Superset of both apps' names (`light` + its driver/owner alias `tap`, `medium`, `selection`,
  `success`, `warning`, `error`, `none`).
- **`Text`** — the typographic primitive. Accepts a semantic `color` name (mapped through the theme)
  OR a raw color string (driver/owner's pattern). Pulled forward from Task 3 because `Button` needs it.
- **`Button`** — the reconciled control: customer's orthogonal `tone` (`azure|success|danger|neutral`)
  × `variant` (`solid|outline|ghost`) API **plus** driver/owner's `iconRight` support (no app loses a
  capability). Spring press-scale + haptic on press; `busy`/`disabled` states; ≥44pt tall.

Task 3 completes the primitive set (Card, Badge, Input, StatTile, …) and extends `src/index.ts`.

## Consumption — raw TypeScript source (no build step)

This package's `main`/`types` point at **`src/index.ts`**, not a compiled `dist/`. Metro bundles the
`.tsx` source directly (exactly how each app already imports its own local components), so the editor,
`tsc`, jest, and the Metro bundler all resolve the **same** files. This deliberately avoids the
"dev server silently runs stale compiled `dist/`" trap that a `dist`-based `main` creates for
`@blue-bee/shared` / `@blue-bee/api-client`. No `metro.config.js` change is needed: driver/owner's
Metro config already `watchFolders` the workspace root and resolves `node_modules` at both levels.

When an app adopts `@blue-bee/ui` (Tasks 4–6) it maps the package to source in its own `tsconfig.json`
`paths` and jest `moduleNameMapper` (pointing at `packages/ui/src/index.ts`) — the same pattern the
apps use for the other workspace packages, but at `src`, keeping the whole chain source-based.

## Scripts

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint . --ext .ts,.tsx
npm test            # jest (jest-expo)
```

`build` is an alias of `typecheck` (`tsc --noEmit`): a source-consumed package emits no artifact.
