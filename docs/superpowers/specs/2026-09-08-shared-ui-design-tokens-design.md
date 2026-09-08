# Shared UI & Design Tokens Consolidation — Design

## Problem

Three React Native apps (`customer`, `driver`, `owner`) and the Next.js web console each maintain their own copy of basic UI building blocks and color/spacing values instead of sharing one source. Concretely:

- `apps/driver/src/components/kit.tsx` and `apps/owner/src/components/kit.tsx` are **byte-identical** — a straight duplicate.
- `apps/customer/components/ui/*` (14 files) is a **separate** implementation of overlapping primitives (Button, Card, Badge, Input, etc.) with a different file layout and a richer prop surface on some components.
- `apps/web/components/ui.tsx` is a Tailwind/React-DOM implementation ("Daylight" system) — cannot share component code with the RN apps (different render target), but should share color/spacing *values*.
- Each RN app has its **own** `theme.ts` (driver/owner byte-identical; customer separately maintained), each explicitly commented `"this is the LOCAL mirror... reconciled at merge"` — a reconciliation that never happened.
- `packages/design-tokens` already exists with real, well-built content (`colors.ts`, `scale.ts`, `effects.ts`, `tailwind-preset.ts`) but has **zero consumers**, and its color token names (`primary`/`accent`, generic) don't match what any app actually uses (`azure`/`honey`, brand-specific — confirmed in production across all 3 RN apps' theme files).
- The color values have already drifted: `packages/design-tokens` and driver/owner's `theme.ts` both carry the *old* brand blue (`azure: '#0B5FFF'`); `apps/customer/theme/theme.ts` was rebranded to "Royal Dry Cleaning" (`azure: '#1E50C8'`, `honey: '#DDA82E'`) and driver/owner/web were never updated to match.
- `packages/ui` is an empty stub (`.gitkeep` + a README describing intent that was never built).
- `docs/design/DESIGN-LANGUAGE.md` (the prose design-system doc) documents the *old* color values and states it "must stay in lock-step" with `packages/design-tokens` — it's stale too.

**Decision already made with the founder:** "Royal Dry Cleaning" is the platform's brand going forward, not a one-off skin. Driver, owner, the console, and `packages/design-tokens` all need to adopt it — not the other way around.

## Goals

1. One canonical set of color/spacing/type/radius/shadow/motion values (`packages/design-tokens`), carrying the Royal Dry Cleaning palette, consumed by all three RN apps and the web console.
2. One shared RN component library (`packages/ui`) holding the primitives all three RN apps genuinely use (Button, Card, Badge, Input, Text, StatTile, Skeleton-equivalent, etc.), replacing driver+owner's duplicate `kit.tsx` entirely and replacing customer's overlapping primitives (not its specialized ones).
3. `docs/design/DESIGN-LANGUAGE.md` updated to match the new canonical values, so the doc and the package stay in the lock-step relationship its own header promises.
4. Zero visual/behavioral change as an *outcome* of this work for any existing screen — this is a relocation + reconciliation of already-shipped code, not a redesign. Where an app's colors literally change (driver/owner/web adopting the new brand), that is the *intended* effect of the already-approved rebrand decision, not a side effect of this refactor.
5. No RN app loses a capability it has today (e.g., driver/owner's `iconRight` support if customer's shared replacement needs it — see Component API Reconciliation below).

## Non-Goals

- **No cross-platform (RN ↔ web) component code sharing.** Different render targets (native views vs. DOM). Web keeps its own Tailwind-based components; it only shares *token values*, via the design-tokens package's existing `tailwindPreset`.
- **No new tooling/build pipeline** (e.g., Style Dictionary, a token-generation step). `packages/design-tokens` is already plain, hand-written TypeScript — that's sufficient and consistent with the rest of this monorepo, which has no comparable generator anywhere else.
- **Customer's specialized components stay local.** `Hero`, `BeeMark`, `Glass`, `IconBadge`, `KeyValue`, `Skeleton`, `Stepper`, `SectionHeader`, `Sheet` (customer-specific booking-flow pieces) are not shared — only genuinely common primitives move to `packages/ui`.
- **No visual redesign.** Existing spacing/type/radius values are preserved as-is (they already agree closely across driver/owner/customer — see Token Reconciliation) — this project's job is to stop duplicating them, not to change what they are.
- **No automated pixel-perfect visual verification.** Per the earlier discussion: this is a conservative code-relocation verified by existing tests; a founder does one manual Radon/simulator pass at the end, matching this codebase's existing split between "proven in code" and "proven on a real device."

## Architecture

```
packages/design-tokens        (already exists; gets new canonical values + azure/honey naming)
  colors.ts    → ColorScale (renamed to azure/honey fields, Royal Dry Cleaning values, light+dark)
  scale.ts     → spacing, radius, fontSize        (unchanged — already consistent across apps)
  effects.ts   → shadow, motion                    (unchanged)
  tailwind-preset.ts → derives Tailwind theme.extend from the same values (already built; needs
                        its hard-coded `primary`/`accent` key names updated to azure/honey to match)
  index.ts     → re-exports all of the above + a `theme` builder (new — see below)
        │
        ├──────────────────────────────┐
        ▼                              ▼
packages/ui (NEW — built from   apps/web/tailwind.config.*
driver+owner's kit.tsx)         (extends the tailwindPreset;
  Button, Card, Badge, Input,   NO component code, values only)
  Text, StatTile, Toast/Sheet-
  equivalents, useTheme()/
  ThemeProvider
        │
        ├── apps/driver  (deletes local kit.tsx + theme.ts, imports @blue-bee/ui)
        ├── apps/owner   (deletes local kit.tsx + theme.ts, imports @blue-bee/ui)
        └── apps/customer (imports shared primitives from @blue-bee/ui for the
                            overlapping ones; keeps its own theme.ts's EXTRA fields
                            — see Token Reconciliation — and its specialized
                            components locally, unchanged)
```

## Token Reconciliation

**Naming:** canonical `packages/design-tokens` `ColorScale` adopts the **azure/honey** naming already live in all three apps (not the currently-unused `primary`/`accent` names). This is a rename inside `packages/design-tokens` only — no app code changes its own field names, since they already use azure/honey.

**Field superset:** driver/owner's `ThemeColors` and customer's `ThemeColors` overlap heavily but each has fields the other lacks:

| Field | driver/owner | customer | Resolution |
|---|---|---|---|
| `canvas`, `subtle`, `surface`, `hairline` | ✓ | ✓ | Keep (values differ slightly — see Values below) |
| `text`, `textSecondary`/`textMuted`, `textTertiary`/`textFaint` | ✓ (`textMuted`/`textFaint`) | ✓ (`textSecondary`/`textTertiary`) | **Standardize on customer's names** (`textSecondary`/`textTertiary`) since they're clearer; driver/owner's kit.tsx call sites get updated to match during the Button/Card/etc. migration (small, mechanical rename, not a new capability either way) |
| `azure`, `azureTint` | ✓ | ✓ | Keep |
| `azureInk` (driver/owner only) | ✓ | ✗ | **Add to canonical scale.** Used for AA-contrast text-on-tint; customer's `onAzureTint` serves the same purpose under a different name — see below |
| `onAzureTint`, `onSuccessTint`, `onWarningTint`, `onDangerTint`, `onHoneyTint` (customer only) | ✗ | ✓ | **These and driver/owner's `*Ink` fields are the same concept** (a legible foreground for text drawn on that status's pale tint). Canonicalize on customer's `onXTint` naming (clearer, and already documented with real reasoning about light/dark asymmetry in customer's file) — driver/owner's kit.tsx call sites that currently read `.azureInk`/`.successInk`/etc. switch to `.onAzureTint`/`.onSuccessTint`/etc. |
| `surfacePressed`, `skeleton`, `skeletonHighlight` (driver/owner only) | ✓ | ✗ | **Add to canonical scale** — customer doesn't use them today but doesn't lose anything by them existing; if customer's own `Skeleton.tsx` (which stays local) wants to adopt the shared skeleton colors later, they're available |
| `glass`, `blurTint` (customer only) | ✗ | ✓ | **Keep in customer's local theme file only** — driver/owner have no frosted-glass UI anywhere in their screens today (confirmed: no `expo-blur` import in either app), so adding it to the shared scale would be dead weight there. If a future increment adds glass UI to driver/owner, promote it to the shared scale then. |
| `honey`, `honeyTint` | ✓ | ✓ | Keep |
| `onAzure`, `onHoney` | ✓ | ✓ | Keep |
| `scrim` | ✓ | ✓ | Keep |

The canonical `packages/design-tokens` `ColorScale` (light + dark) ends up as the union: `canvas, subtle, surface, surfacePressed, hairline, text, textSecondary, textTertiary, azure, azureTint, honey, honeyTint, success, successTint, warning, warningTint, danger, dangerTint, onAzure, onHoney, onAzureTint, onSuccessTint, onWarningTint, onDangerTint, onHoneyTint, scrim, skeleton, skeletonHighlight`.

**Values:** adopt customer's Royal Dry Cleaning values as canonical (light: `azure #1E50C8`, `honey #DDA82E`, `canvas #F4F6FB`, `subtle #EAEFF7`, `hairline #E4E9F2`; dark scale from customer's file). Driver/owner's `surfacePressed`/`skeleton`/`skeletonHighlight` (fields customer doesn't have) keep their existing driver/owner VALUES (`#EEF3FA` / `#E9EEF5` / `#F4F7FB` light; matching dark) since there's no Royal Dry Cleaning equivalent to reconcile against — they're additive, not conflicting.

**Type scale, spacing, radius:** driver/owner's `typography` includes an `overline` variant customer's `type` lacks; customer's has `title3`/`headline`/etc. with slightly different letter-spacing tuning than driver/owner's. Canonical scale takes driver/owner's full variant set (includes `overline`) with customer's letter-spacing values (the more recently-tuned ones, per customer being the most recently actively designed surface). Spacing scale (`xs..xxxl`/`huge`) and radius scale are already near-identical between all three — reconcile to the union (customer lacks driver/owner's plain `sm: 10` radius token; add it).

**`docs/design/DESIGN-LANGUAGE.md`:** update its §2 color table to the new values and field names, so it matches the package it claims to document.

## Component API Reconciliation

Every shared primitive gets a **superset API** — the union of both existing versions' props, never dropping a capability. Worked example (`Button`, the most divergent case found):

- Customer's `Button` has separate `tone` (`azure | success | danger | neutral`) and `variant` (`solid | outline | ghost`) props — 12 combinations.
- driver/owner's `Button` has one combined `variant` (`primary | danger | ghost | ...`), plus an `iconRight` prop customer's lacks, plus different defaults (`fullWidth` defaults `false` vs. customer's `true`; `haptic` defaults `'tap'` vs. customer's `'light'`).

**Resolution:** the shared `packages/ui` `Button` takes customer's orthogonal `tone`/`variant` shape (strictly more expressive — a combined `variant` can always be expressed as `tone` + `variant`, but not vice versa) **plus** driver/owner's `iconRight` prop. Defaults are decided per-callsite compatibility: keep whichever default lets the MOST existing call sites omit the prop unchanged (verify empirically per prop during implementation — count call sites, don't guess), and where callers relied on the old default, pass it explicitly at the call site instead of silently changing behavior.

This same **superset-API, verify-empirically, never-drop-a-capability** principle applies to every other shared primitive (Card, Badge, Input, StatTile, Text) — the implementation plan's tasks will each do this per-component, since the exact prop diffs for the others weren't individually audited during this design pass (Button was audited as the representative worked example; the others follow the same method).

## `packages/ui`'s public surface

```typescript
// packages/ui/src/index.ts
export { ThemeProvider, useTheme } from './theme';        // wraps @blue-bee/design-tokens
export { Button, type ButtonProps, type ButtonTone, type ButtonVariant } from './Button';
export { Card, type CardProps } from './Card';
export { Badge, type BadgeProps } from './Badge';
export { Input, type InputProps } from './Input';
export { Text, type TextProps } from './Text';
export { StatTile, type StatTileProps } from './StatTile';
// + whatever else the per-component audit confirms is genuinely shared (Skeleton primitive,
// StatusPill, etc.) — enumerated precisely in the implementation plan once each is audited.
export { toneColors, type Tone } from './tone';            // driver/owner's existing helper, moved verbatim
export { haptics, type HapticKind } from './haptics';      // driver/owner's existing helper, moved verbatim
```

`useTheme()` returns the same shape driver/owner's kit.tsx already expects (`{ colors, spacing, radius, type, font, shadow, scheme, isDark }` — exact field names reconciled per Token Reconciliation above), so the bulk of kit.tsx's internal implementation moves verbatim; only the color/text field renames from the reconciliation table need mechanical updates inside the moved file.

## Migration Order

1. Update `packages/design-tokens` (rename to azure/honey, Royal Dry Cleaning values, superset color scale, superset type scale). Update `docs/design/DESIGN-LANGUAGE.md` to match. Run `packages/design-tokens`'s own existing test suite (`tokens.test.ts`).
2. Build `packages/ui` from driver/owner's `kit.tsx` (near-verbatim move + the field-name updates from step 1's reconciliation + the Button superset API). New package needs its own `package.json`/`tsconfig.json`/`.eslintrc.js`/`jest.config.js`, mirroring `packages/api-client`'s existing structure (the closest analog: a TS package consumed by RN apps).
3. Migrate `apps/driver`: delete local `kit.tsx` + `theme.ts`, repoint every import to `@blue-bee/ui`, run driver's full test suite.
4. Migrate `apps/owner` the same way (should be near-identical to driver's migration since they started byte-identical).
5. Migrate `apps/customer`: for each of customer's components that has a shared equivalent (Button, Card, Badge, Input — confirmed overlapping; others TBD per the per-component audit), switch imports to `@blue-bee/ui` and delete the local duplicate; customer's specialized components (Hero, BeeMark, Glass, IconBadge, KeyValue, Skeleton, Stepper, SectionHeader, Sheet) stay local but their theme values now come from the shared `useTheme()` instead of customer's own local `theme.ts` (which gets deleted, its unique fields like `glass`/`blurTint` either promoted to the shared scale if genuinely needed elsewhere or kept as a small customer-local extension file that imports the shared theme and adds just those two fields — decide during implementation based on how cleanly `glass`/`blurTint` layer on top of a shared `useTheme()` result). Run customer's full test suite.
6. Wire `apps/web`'s Tailwind config to `packages/design-tokens`'s `tailwindPreset` (values only, per the Non-Goals section) — update the preset's hard-coded `primary`/`accent` Tailwind class names to `azure`/`honey` first (step 1), then have web's config `extend` from it instead of (or alongside) its own hand-maintained color values. Run web's full test suite.

Each step is independently shippable and independently testable — if step 5 (customer) turns out to be larger than expected, steps 1-4 are still a complete, valuable, mergeable unit on their own.

## Testing

- No new visual/snapshot tests are being introduced by this work — the existing unit test suites for each app (which mock/render components already) are the regression net. If a component's move surfaces a rendering test that was implicitly relying on an implementation detail (e.g., a specific hex value asserted in a test rather than through the theme), fix the test to assert through the theme instead, per this codebase's existing convention elsewhere.
- `packages/design-tokens` already has `tokens.test.ts` — extend it to cover the renamed/superset fields.
- `packages/ui` needs its own new test file(s) for the moved components — at minimum, confirm they render, confirm the reconciled Button API's `tone`×`variant` combinations resolve to sensible colors, matching the level of test rigor `packages/api-client`'s own test suite already sets as this monorepo's bar for a shared package.
- Full suite (`npx turbo run typecheck && npx turbo run lint && npm run test:api-safe` equivalent per-app) run after each migration step, not just at the end — catches a broken import immediately rather than after 6 apps' worth of changes have piled up.

## Open Items for the Implementation Plan (not resolved here — by design)

- The exact per-component prop audit for Card/Badge/Input/StatTile/Text (Button was the worked example; the others need the same treatment, likely one per implementation-plan task).
- Whether `glass`/`blurTint` become a small customer-local theme extension or get promoted to the shared scale — decide once the migration actually reaches customer (step 5), when it's clear whether any other app has grown a frosted-UI need in the meantime.
- `packages/ui`'s exact package.json/build tooling — mirror `packages/api-client`'s (closest existing analog), confirm during implementation whether an RN package needs anything different (e.g., does it need to ship compiled output, or can RN apps consume it via the same tsconfig-paths-to-source pattern the monorepo already uses for `packages/shared`? — Note: the earlier full-project review flagged this exact "dev server silently runs stale compiled code" trap for `packages/shared`/`packages/api-client`; do not repeat it for `packages/ui` — favor the tsconfig-paths-to-source pattern if it avoids the trap, or add a dev/watch script if a build step is unavoidable).
