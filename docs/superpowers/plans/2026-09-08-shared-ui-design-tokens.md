# Shared UI & Design Tokens Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 3 duplicate/divergent React Native UI implementations (driver+owner byte-identical `kit.tsx`, customer's separate component set) and an unused, misnamed `packages/design-tokens` draft with one canonical, Royal-Dry-Cleaning-branded token package and one shared `packages/ui` component library — closing the color drift already found between apps, without changing any existing screen's behavior or visuals as a side effect of the refactor itself.

**Architecture:** `packages/design-tokens` (pure values) ← consumed by → `packages/ui` (RN components, wraps the tokens in a `useTheme()` hook) ← consumed by → `apps/driver`, `apps/owner`, `apps/customer`. `apps/web`'s Tailwind config consumes `packages/design-tokens`'s `tailwindPreset` directly (values only — web never imports RN components).

**Tech Stack:** TypeScript, React Native + Expo (the 3 mobile apps), Next.js + Tailwind (web), npm workspaces + Turborepo, Jest.

**Spec:** `docs/superpowers/specs/2026-09-08-shared-ui-design-tokens-design.md` — read this in full before starting; it contains the token-naming decision, the full field-reconciliation table, and the Button API worked example this plan builds on. This plan implements that spec; where this plan's code and the spec's prose ever disagree on a value, the spec is the source of truth for the *decision*, this plan for the *exact code*.

## Global Constraints

- **TypeScript strict** everywhere — no new `any`.
- **No stubs.** Every step ships real code proven by a real, passing test.
- **Zero behavior/visual change except the intended brand-color update.** This is a relocation + reconciliation, not a redesign. If a component's moved code would render differently than it does today (beyond the approved color change), stop and flag it — don't ship a silent visual regression.
- **Never drop a capability.** Where two apps' versions of a component differ, the shared version must support everything both did (see the spec's Component API Reconciliation section and its Button worked example).
- **Verify against real source before writing reconciliation code** — the spec's Button analysis is real and can be trusted verbatim; the *other* components' prop diffs were NOT individually audited in the spec (it says so explicitly) and must be freshly read from actual source in this plan's tasks, not assumed.
- **Run each app's full test suite after its migration step**, not just at the very end.
- **Commit after each task**, message style `feat(scope): ...` / `refactor(scope): ...` matching existing history. Never `--no-verify`.
- **Append a dated line to `CHANGELOG.md`** as the last step of each task, using the actual date/time you ship it.
- **A founder does one manual Radon/simulator visual check at the end** — this plan's own testing cannot fully substitute for that (no simulator available in this environment); say so plainly in the final task's report rather than claiming full visual proof.

---

### Task 1: Update `packages/design-tokens` to the canonical, Royal-Dry-Cleaning-branded, azure/honey-named token set

**Files:**
- Modify: `packages/design-tokens/src/colors.ts`
- Modify: `packages/design-tokens/src/scale.ts`
- Modify: `packages/design-tokens/src/tailwind-preset.ts`
- Modify: `packages/design-tokens/src/tokens.test.ts`
- Modify: `docs/design/DESIGN-LANGUAGE.md`

**Interfaces:**
- Produces: `ColorScale` (renamed fields, superset per the spec's reconciliation table), `light`, `dark`, exported from `colors.ts` exactly as today but with new shape/values. `TypeVariant`/`fontSize` gains an `overline` entry. No other package consumes this yet (Task 2 is the first real consumer) — this task's own test file is the only thing that needs to pass.

- [ ] **Step 1: Write the failing test**

Read the current `packages/design-tokens/src/tokens.test.ts` in full first (to match its existing style), then add assertions for the new shape. At minimum:

```typescript
import { light, dark } from './colors';

describe('canonical color scale — Royal Dry Cleaning brand, azure/honey naming', () => {
  it('uses the azure/honey brand fields, not the old generic primary/accent names', () => {
    expect(light).not.toHaveProperty('primary');
    expect(light).not.toHaveProperty('accent');
    expect(light.azure).toBeDefined();
    expect(light.honey).toBeDefined();
  });

  it('carries the Royal Dry Cleaning brand values', () => {
    expect(light.azure).toBe('#1E50C8');
    expect(light.honey).toBe('#DDA82E');
  });

  it('has the full reconciled field superset in both light and dark', () => {
    const requiredFields = [
      'canvas', 'subtle', 'surface', 'surfacePressed', 'hairline',
      'text', 'textSecondary', 'textTertiary',
      'azure', 'azureTint', 'honey', 'honeyTint',
      'success', 'successTint', 'warning', 'warningTint', 'danger', 'dangerTint',
      'onAzure', 'onHoney', 'onAzureTint', 'onSuccessTint', 'onWarningTint', 'onDangerTint', 'onHoneyTint',
      'scrim', 'skeleton', 'skeletonHighlight',
    ];
    for (const field of requiredFields) {
      expect(light).toHaveProperty(field);
      expect(dark).toHaveProperty(field);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx jest tokens.test.ts
```
(from `packages/design-tokens`) — expected: FAIL, current `ColorScale` has `primary`/`accent`, not `azure`/`honey`, and lacks most of the superset fields.

- [ ] **Step 3: Replace `colors.ts`**

Replace the entire file with:

```typescript
/**
 * Daylight — color tokens (light + dark), Royal Dry Cleaning brand.
 *
 * These are the founder's canonical values (see docs/design/DESIGN-LANGUAGE.md). Every RN app and
 * the web console read colors from here — this is the single typed source; nothing hard-codes a hex
 * outside this file. Token names (azure/honey) match what's already live in production across all
 * three mobile apps — see docs/superpowers/specs/2026-09-08-shared-ui-design-tokens-design.md for
 * why these names were kept over the generic primary/accent names this file used to have.
 *
 * `onXTint` fields are the legible foreground for text drawn ON that status's pale tint background —
 * in light mode these are deep shades of the hue (the bright semantic color fails contrast on its own
 * tint); in dark mode they're the bright hue (reads fine on the dark translucent tint). Use the bright
 * `success/warning/danger/honey`/`azure` values only for fills, icons, dots, and borders — never for
 * text on the matching tint.
 */

export interface ColorScale {
  /** App background — the page/screen canvas. */
  canvas: string;
  /** A faintly recessed background (grouped rows, inset panels). */
  subtle: string;
  /** Raised surface (cards, sheets, inputs). */
  surface: string;
  /** Pressed/active surface tint (list rows, buttons mid-press). */
  surfacePressed: string;
  /** 1px separators / borders. */
  hairline: string;

  text: string;
  textSecondary: string;
  textTertiary: string;

  /** Brand primary — the crest's royal blue. */
  azure: string;
  /** Azure wash (selected chips, info cards, marker halo). */
  azureTint: string;
  /** Brand accent — the crown's gold. */
  honey: string;
  /** Honey wash. */
  honeyTint: string;

  success: string;
  successTint: string;
  warning: string;
  warningTint: string;
  danger: string;
  dangerTint: string;

  /** Text drawn ON a solid azure / honey fill (contrast-safe). */
  onAzure: string;
  onHoney: string;

  /** Legible foregrounds for text on the matching pale TINT (see file doc comment above). */
  onAzureTint: string;
  onSuccessTint: string;
  onWarningTint: string;
  onDangerTint: string;
  onHoneyTint: string;

  /** Modal scrim behind sheets. */
  scrim: string;
  /** Skeleton loading-state base + highlight. */
  skeleton: string;
  skeletonHighlight: string;
}

export const light: ColorScale = {
  canvas: '#F4F6FB',
  subtle: '#EAEFF7',
  surface: '#FFFFFF',
  surfacePressed: '#EEF3FA',
  hairline: '#E4E9F2',

  text: '#0A2540',
  textSecondary: '#5A6B82',
  textTertiary: '#8A99AE',

  azure: '#1E50C8',
  azureTint: '#E7ECFB',
  honey: '#DDA82E',
  honeyTint: '#FAF3DF',

  success: '#14B86A',
  successTint: '#E5F8EE',
  warning: '#F59E0B',
  warningTint: '#FEF3E2',
  danger: '#E5484D',
  dangerTint: '#FDECEC',

  onAzure: '#FFFFFF',
  onHoney: '#3D2C00',

  onAzureTint: '#1E50C8',
  onSuccessTint: '#0A7C46',
  onWarningTint: '#8A5300',
  onDangerTint: '#C42A1F',
  onHoneyTint: '#7A5800',

  scrim: 'rgba(10,37,64,0.45)',
  skeleton: '#E9EEF5',
  skeletonHighlight: '#F4F7FB',
};

export const dark: ColorScale = {
  canvas: '#0A0E1A',
  subtle: '#111728',
  surface: '#141B2D',
  surfacePressed: '#1B2438',
  hairline: 'rgba(255,255,255,0.08)',

  text: '#EAF0F8',
  textSecondary: '#9DB0C9',
  textTertiary: '#6B7C96',

  azure: '#5B87F5',
  azureTint: 'rgba(91,135,245,0.18)',
  honey: '#E8B84D',
  honeyTint: 'rgba(232,184,77,0.16)',

  success: '#2DD583',
  successTint: 'rgba(45,213,131,0.16)',
  warning: '#FFC34D',
  warningTint: 'rgba(255,195,77,0.16)',
  danger: '#FF6168',
  dangerTint: 'rgba(255,97,104,0.16)',

  onAzure: '#FFFFFF',
  onHoney: '#241A00',

  onAzureTint: '#5B87F5',
  onSuccessTint: '#2DD583',
  onWarningTint: '#FFC34D',
  onDangerTint: '#FF6168',
  onHoneyTint: '#E8B84D',

  scrim: 'rgba(0,0,0,0.6)',
  skeleton: '#1B2438',
  skeletonHighlight: '#222D45',
};

export const color = { light, dark } as const;
```

- [ ] **Step 4: Add the `overline` type variant to `scale.ts`**

Read `packages/design-tokens/src/scale.ts` in full first. Find its `fontSize` export (the `FontSizeToken`-typed record). Add an `overline` entry matching driver/owner's existing `typography.overline` value (`{ fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.7 }`), converting to whatever field-name shape `scale.ts`'s existing `FontSizeToken` interface uses (check the interface first — the plan's earlier research found driver/owner's `typography` uses `fontWeight`/`letterSpacing` as plain object fields, but `scale.ts`'s own `FontSizeToken`/`TypeStyle` types were NOT read during planning — read them now and match their actual shape, don't assume). Also add a plain `sm: 10` radius token to whatever `radius` export exists in this file (driver/owner have this; customer/`scale.ts` may not — verify and add if missing).

- [ ] **Step 5: Update `tailwind-preset.ts`'s hard-coded color keys**

Read the current file (already shown in the spec's research — reproduced here for reference, but re-read the live file since Step 3/4 changed what it imports from): change every `primary`/`accent` Tailwind key to `azure`/`honey`, matching the renamed `ColorScale` fields. The `colors` object inside `tailwindPreset.theme.extend` becomes:

```typescript
      colors: {
        canvas: light.canvas,
        subtle: light.subtle,
        surface: light.surface,
        hairline: light.hairline,
        text: {
          DEFAULT: light.text,
          secondary: light.textSecondary,
          tertiary: light.textTertiary,
        },
        azure: {
          DEFAULT: light.azure,
          tint: light.azureTint,
        },
        honey: { DEFAULT: light.honey, tint: light.honeyTint },
        success: { DEFAULT: light.success, tint: light.successTint },
        warning: { DEFAULT: light.warning, tint: light.warningTint },
        danger: { DEFAULT: light.danger, tint: light.dangerTint },
      },
```

(Note: the old `text: { primary: ..., secondary: ..., tertiary: ... }` shape had a redundant `primary` sub-key since the outer key was already `text` — this version drops that redundancy since `ColorScale.text` replaces the old `ColorScale.textPrimary`; if any consumer already expects `text-primary` as a literal Tailwind class name, that's Task 7's problem to reconcile since web is the only Tailwind consumer and it doesn't exist as a preset-consumer yet — verify this assumption in Task 7, not here.)

`primaryHover`/`primaryActive` fields no longer exist on `ColorScale` (dropped — they weren't in the spec's reconciled superset since neither driver/owner's nor customer's actual `ThemeColors` interfaces have hover/active variants; RN has no hover state, and web's own separate `ui.tsx` handles its own press/hover states independently of this shared preset). Remove any reference to them in this file if present.

- [ ] **Step 6: Run the test to verify it passes**

```
npx jest tokens.test.ts
```

- [ ] **Step 7: Run the full package test/typecheck/lint**

```
npm run typecheck && npm run lint && npm test
```
(from `packages/design-tokens`)

- [ ] **Step 8: Update `docs/design/DESIGN-LANGUAGE.md`**

Update §2 (Color) to reflect the new field names and values — the doc's own header says it "must stay in lock-step" with this package. At minimum, update the §2.1 table's `primary`/`primaryHover`/`primaryActive` rows to `azure` (drop the hover/active rows per Step 5's reasoning, or note in the doc that RN has no hover state and web's press states live in its own component layer — your call on the clearest phrasing, but don't leave stale hover/active rows pointing at fields that no longer exist). Add rows for the new superset fields (`surfacePressed`, `onAzureTint`/etc., `skeleton`/`skeletonHighlight`) with a one-line description each, matching the table's existing format. Update the color hex values to match Step 3's `light`/`dark` exports exactly.

- [ ] **Step 9: Update CHANGELOG.md**

```
- HH:MM IST · **feat(design-tokens): rename to azure/honey, adopt Royal Dry Cleaning brand values, add the reconciled field superset** — `packages/design-tokens`'s `ColorScale` previously used generic `primary`/`accent` names nothing in the codebase actually used, and still carried the old pre-rebrand blue. Renamed to `azure`/`honey` (matching what's already live across all 3 mobile apps) with the Royal Dry Cleaning values, and added the fields driver/owner's and customer's separate theme files each had that the other lacked. First step of consolidating the shared design system (see docs/superpowers/specs/2026-09-08-shared-ui-design-tokens-design.md). → `packages/design-tokens/src/{colors,scale,tailwind-preset,tokens.test}.ts`, `docs/design/DESIGN-LANGUAGE.md`
```

- [ ] **Step 10: Commit**

```bash
git add packages/design-tokens docs/design/DESIGN-LANGUAGE.md CHANGELOG.md
git commit -m "feat(design-tokens): rename to azure/honey, adopt Royal Dry Cleaning brand, reconcile field superset"
```

---

### Task 2: Scaffold `packages/ui` and build its theme layer + `Button` (the reconciled worked example)

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/.eslintrc.js`, `packages/ui/jest.config.js`
- Create: `packages/ui/src/theme.ts`
- Create: `packages/ui/src/haptics.ts`
- Create: `packages/ui/src/Button.tsx`, `packages/ui/src/Button.test.tsx`
- Create: `packages/ui/src/index.ts`
- Delete: `packages/ui/.gitkeep`
- Modify: `packages/ui/README.md`
- Modify (root): `package.json` if a workspace-wide reference needs updating (check — `apps/*`/`packages/*` glob patterns already cover a new package, likely no change needed; verify)

**Interfaces:**
- Consumes: `@blue-bee/design-tokens`'s `color`, `space`, `radius`, `fontSize`, `shadow`, `motion` (Task 1's output).
- Produces: `useTheme(): Theme`, `ThemeProvider` (if driver/owner's pattern needs one — check, since driver/owner's current `useTheme()` reads `useColorScheme()` directly with NO provider; preserve that exact pattern, don't introduce a provider that isn't there today), `Button`, `type ButtonProps`, `toneColors`, `type Tone`, `fireHaptic`, `type HapticKind` — all exported from `packages/ui/src/index.ts`, consumed starting in Task 3 (Card/etc.) and Task 4 (driver migration).

**Package scaffold:** mirror `packages/api-client`'s `package.json` shape (name `@blue-bee/ui`, same `scripts` block: `build`/`typecheck`/`lint`/`test`), but this package has React Native peer dependencies driver/owner/customer already have (`react`, `react-native`, `@expo/vector-icons`, `react-native-safe-area-context`) — declare these as `peerDependencies`, not `dependencies` (the consuming apps already provide them; a shared RN component library should never bundle its own copy of `react-native`). Read `apps/driver/package.json` for the exact version ranges of `react`, `react-native`, `@expo/vector-icons`, `react-native-safe-area-context` currently in use, and match those ranges as the peer dependency constraints.

**Consumption pattern — avoid the stale-compiled-package trap:** the earlier full-project review flagged that `packages/shared`/`packages/api-client` are consumed via a *built* `dist/` in each app's `package.json` `main` field, but each app's `tsconfig.json` `paths` points straight at `src/` — meaning a dev server can silently run stale compiled output while the editor/typecheck looks fresh. Check whether `packages/api-client`'s `package.json` "main"/"types" point at "dist" (Task 5/6 of the prior priority-fixes plan found they do). For `packages/ui`, follow whichever pattern driver/owner/customer's OWN existing internal imports already use for cross-file same-app imports (they import `.tsx` files directly with no build step, since it's all one Metro/Expo bundle) — RN/Expo apps typically DON'T need a separate compiled `dist/` for a workspace package the same way a Node.js API does, since Metro's bundler can resolve TypeScript source directly across workspace packages if configured to. Investigate `apps/driver`'s Metro config (`metro.config.js`) for `watchFolders`/`resolver` settings that already support this for other workspace packages, and follow the SAME pattern for `packages/ui` — don't introduce a new, different consumption mechanism. If no such Metro config exists yet, that's a real gap this task needs to close (add it), since otherwise `packages/ui` would need a build step none of the 3 RN apps currently have infrastructure to consume live.

- [ ] **Step 1: Investigate the actual Metro/workspace-package consumption pattern before writing any package.json**

Read `apps/driver/metro.config.js` (or wherever Expo/Metro config lives for that app), `apps/driver/package.json`'s dependencies (does it depend on any OTHER `@blue-bee/*` package today? `@blue-bee/shared` per earlier context — check exactly how that dependency resolves: source or dist). Report your finding before proceeding — this determines whether `packages/ui` ships a `dist/` with a build step, or is consumed as raw TypeScript source via a Metro resolver config. Do not guess; this is exactly the kind of infrastructure question that's cheap to verify and expensive to get wrong (three apps depending on it).

- [ ] **Step 2: Create the package scaffold based on Step 1's finding**

Create `packages/ui/package.json`, `.eslintrc.js` (copy `packages/api-client/.eslintrc.js` verbatim — same TS-only lint config pattern, add a React/RN-aware override if `.tsx` files need `react`/`react-hooks` plugin rules that the pure-TS `api-client` config doesn't have; check `apps/driver/.eslintrc.js` for what RN-specific lint config it already uses and mirror that instead if it differs meaningfully), `tsconfig.json` (check `apps/driver/tsconfig.json` for its `jsx`/`lib` compiler options relevant to RN — a UI package needs the same `jsx` setting), `jest.config.js` (check `apps/driver/jest.config.js` for its RN-specific Jest setup — likely needs `preset: 'jest-expo'` or similar; match it).

- [ ] **Step 3: Write the failing test for `useTheme()`**

Create `packages/ui/src/theme.test.ts`:

```typescript
import { useTheme } from './theme';
import { renderHook } from '@testing-library/react-hooks'; // or whatever RN-test-hook utility apps/driver's existing tests use — check apps/driver/src/theme.test.ts if one exists, and match its exact testing approach instead of assuming this import

describe('useTheme (packages/ui)', () => {
  it('returns the reconciled color scale field names, not the old driver/owner-only names', () => {
    // Exact assertion shape depends on Step 1/2's findings about how color-scheme is mocked in
    // this codebase's existing RN tests — read apps/driver/src/theme.test.ts (if present) or
    // apps/driver/src/components/kit.test.tsx's theme-mocking setup and match it exactly.
  });
});
```

This step is deliberately not fully pre-written — the exact RN color-scheme-mocking test pattern needs to be copied from this codebase's own existing tests (driver's `theme.ts` and `kit.tsx` are both already tested somewhere in `apps/driver/src/**/*.test.tsx` — find those files first and follow their exact pattern verbatim, don't invent a new testing approach for RN hooks this codebase doesn't already use).

- [ ] **Step 4: Write `packages/ui/src/theme.ts`**

Move driver/owner's `theme.ts` (already read in full during planning) into this file almost verbatim, with these specific changes:
1. Import `color`, `space`, `radius`, `fontSize`, `shadow`, `motion` from `@blue-bee/design-tokens` instead of defining `light`/`dark`/`spacing`/etc. locally.
2. Rename every reference to match Task 1's reconciled field names: `textMuted` → `textSecondary`, `textFaint` → `textTertiary`, `azureInk` → `onAzureTint`, `honeyInk` → `onHoneyTint`, `successInk` → `onSuccessTint`, `warningInk` → `onWarningTint`, `dangerInk` → `onDangerTint`.
3. Add the `overline` variant to the local `typography`/`type` re-export (should already be present via `@blue-bee/design-tokens`'s `fontSize` after Task 1 Step 4 — use it from there rather than redefining).
4. Keep the exact same `useTheme()` hook signature, `Theme` interface shape, `toneColors()` helper, `Tone` type, `HIT_SLOP`/`MIN_TARGET` constants — these are pure logic, not colors, and don't need reconciliation.

- [ ] **Step 5: Write `packages/ui/src/haptics.ts`**

Move driver/owner's `haptics.ts` (referenced by `kit.tsx` but not read in full during planning — read `apps/driver/src/components/haptics.ts` now) verbatim into `packages/ui/src/haptics.ts`. No logic changes expected — this is a pure utility with no theme/color dependency.

- [ ] **Step 6: Write `packages/ui/src/Button.tsx`** — the reconciled superset API

Per the spec's worked example: combine customer's orthogonal `tone`/`variant` props with driver/owner's `iconRight` prop. Before writing the final version, re-read BOTH `apps/customer/components/ui/Button.tsx` and `apps/driver/src/components/kit.tsx`'s `Button` implementation one more time in full (both were read during planning — re-verify nothing changed since) and grep every call site of each (`grep -rn "<Button" apps/customer/src apps/customer/components apps/driver/src apps/owner/src`) to determine the empirically-most-common default for `fullWidth` and `haptic` per the spec's "count call sites, don't guess" instruction. Then write:

```typescript
import React from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, usePressScale } from './theme';
import { Text } from './Text'; // Task 3 builds this — Button depends on it; if Task 3 hasn't run yet in your session, stop and build a minimal Text first, or reorder: this dependency means Text should actually be built in THIS task alongside Button, not deferred to Task 3. Re-read Task 3 before starting this step and pull Text's creation forward into this task if Task 3 hasn't already happened.
import { fireHaptic, type HapticKind } from './haptics';

export type ButtonTone = 'azure' | 'success' | 'danger' | 'neutral';
export type ButtonVariant = 'solid' | 'outline' | 'ghost';
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  tone?: ButtonTone;
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  disabled?: boolean;
  /** A Feather icon name rendered before the label. */
  icon?: React.ComponentProps<typeof Feather>['name'];
  /** A Feather icon name rendered after the label (driver/owner's capability — preserved here). */
  iconRight?: React.ComponentProps<typeof Feather>['name'];
  haptic?: HapticKind;
  fullWidth?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const SIZE: Record<ButtonSize, { minHeight: number; paddingH: number; gap: number; icon: number }> = {
  lg: { minHeight: 54, paddingH: 20, gap: 8, icon: 19 },
  md: { minHeight: 46, paddingH: 16, gap: 7, icon: 17 },
  sm: { minHeight: 36, paddingH: 12, gap: 6, icon: 15 },
};

/**
 * The shared Daylight button — reconciles customer's orthogonal tone×variant API with driver/owner's
 * iconRight support (see docs/superpowers/specs/2026-09-08-shared-ui-design-tokens-design.md's
 * Component API Reconciliation section for why). Spring press-scale + haptic on press; solid/outline/
 * ghost across azure/success/danger/neutral tones; busy + disabled states; ≥44pt tall.
 */
export function Button({
  label,
  onPress,
  tone = 'azure',
  variant = 'solid',
  size = 'lg',
  busy = false,
  disabled = false,
  icon,
  iconRight,
  haptic = 'light',
  fullWidth = true,
  testID,
  style,
}: ButtonProps): React.ReactElement {
  const { colors, radius } = useTheme();
  const press = usePressScale(!disabled && !busy);
  const dims = SIZE[size];
  const isDisabled = disabled || busy;

  const toneColor =
    tone === 'azure' ? colors.azure : tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.text;

  let bg = 'transparent';
  let fg = toneColor;
  let borderColor = 'transparent';
  let borderWidth = 0;

  if (variant === 'solid') {
    bg = tone === 'neutral' ? colors.subtle : toneColor;
    fg = tone === 'neutral' ? colors.text : tone === 'azure' ? colors.onAzure : '#FFFFFF';
    if (tone === 'neutral') {
      borderColor = colors.hairline;
      borderWidth = StyleSheet.hairlineWidth;
    }
  } else if (variant === 'outline') {
    bg = colors.surface;
    fg = toneColor;
    borderColor = tone === 'neutral' ? colors.hairline : toneColor;
    borderWidth = 1.5;
  }

  const handlePress = (): void => {
    if (isDisabled) return;
    fireHaptic(haptic);
    onPress?.();
  };

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy }}
      accessibilityLabel={label}
      style={fullWidth ? undefined : styles.inlineWrap}
    >
      <Animated.View
        style={[
          styles.base,
          {
            minHeight: dims.minHeight,
            paddingHorizontal: dims.paddingH,
            gap: dims.gap,
            backgroundColor: bg,
            borderColor,
            borderWidth,
            borderRadius: radius.button,
            opacity: isDisabled ? 0.4 : 1,
            transform: press.transform,
          },
          style,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={styles.content}>
            {icon ? <Feather name={icon} size={dims.icon} color={fg} style={{ marginRight: dims.gap }} /> : null}
            <Text variant={size === 'sm' ? 'subhead' : 'headline'} weight="600" style={{ color: fg }}>
              {label}
            </Text>
            {iconRight ? <Feather name={iconRight} size={dims.icon} color={fg} style={{ marginLeft: dims.gap }} /> : null}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  inlineWrap: { alignSelf: 'flex-start' },
});
```

Note: `fullWidth` defaults to `true` here (customer's default) and `haptic` defaults to `'light'` (customer's default) — per Step 6's call-site-count instruction, VERIFY this is actually the majority default across all call sites in both apps combined before committing to it; if driver/owner's call sites overwhelmingly rely on the OLD `false`/`'tap'` defaults and would all need an explicit prop added, that's a real cost to weigh — report your count and your choice in this task's report either way, don't silently pick one without checking.

- [ ] **Step 7: Write `packages/ui/src/Button.test.tsx`**

Cover: renders the label; `onPress` fires (and haptic fires) on press when not disabled/busy; disabled/busy blocks `onPress`; `busy` shows an `ActivityIndicator` instead of the label; `icon` and `iconRight` both render when provided; each `tone`×`variant` combination resolves to a non-crashing render (a simple parameterized render-without-throwing test across all 12 combinations is sufficient — this is a shared primitive, not app logic, so exhaustive visual assertion isn't the bar, but exhaustive "doesn't crash + resolves internally consistent colors" is).

- [ ] **Step 8: Write `packages/ui/src/index.ts`**

```typescript
export { useTheme, toneColors, HIT_SLOP, MIN_TARGET, type Theme, type ThemeColors, type Tone, type Scheme, type TypeVariant } from './theme';
export { fireHaptic, type HapticKind } from './haptics';
export { Button, type ButtonProps, type ButtonTone, type ButtonVariant, type ButtonSize } from './Button';
```
(Task 3 extends this file with the remaining primitives — don't treat this as final.)

- [ ] **Step 9: Update `packages/ui/README.md`**, delete `.gitkeep`

Replace the README's placeholder description with an accurate one describing what's actually in the package now (theme, haptics, Button — noting Task 3 completes the primitive set), and delete `.gitkeep` now that real files exist.

- [ ] **Step 10: Run tests**

```
npm run typecheck && npm run lint && npm test
```
(from `packages/ui`)

- [ ] **Step 11: Update CHANGELOG.md**

```
- HH:MM IST · **feat(ui): scaffold packages/ui with the shared theme layer and a reconciled Button** — new shared RN component library consuming @blue-bee/design-tokens; Button merges customer's tone×variant API with driver/owner's iconRight support (neither app loses a capability). First real consumer of Task 1's token package. → `packages/ui/**`
```

- [ ] **Step 12: Commit**

```bash
git add packages/ui CHANGELOG.md
git commit -m "feat(ui): scaffold packages/ui with the shared theme layer and a reconciled Button component"
```

---

### Task 3: Build the remaining shared primitives (Card, Badge, Input, Text, StatTile)

**Files:**
- Create: `packages/ui/src/{Text,Card,Badge,Input,StatTile}.tsx` + matching `.test.tsx` for each
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `packages/ui/src/theme.ts` (Task 2).
- Produces: `Text`, `Card`, `Badge`, `Input`, `StatTile` + their prop types, added to `packages/ui/src/index.ts`'s exports. Task 2's `Button` already imports `Text` from this task — if Task 2 was executed strictly before this task, its `Text` import will fail to resolve until this task lands; the two tasks should be treated as adjacent/sequential with no other task landing in between, OR (simpler) build `Text` as part of Task 2 instead, since Button hard-depends on it. **Resolve this ordering explicitly at execution time**: if you're the Task 2 implementer and `Text` doesn't exist yet, build a real (not stub) minimal `Text` component as part of Task 2 rather than leaving a broken import — then this task's `Text` work becomes "verify/extend the one Task 2 already built" instead of "build from scratch." Whichever implementer hits this first should build real `Text`; the other confirms and extends.

This task is the same shape repeated 5 times — batched into one task per the "same-shape work" principle, but each component gets its own full investigation, not a copy-paste of Button's specifics (Button's prop differences don't generalize to the others; each needs its own real diff).

- [ ] **Step 1: For each of Text/Card/Badge/Input/StatTile — investigate before writing**

For each component, find BOTH its driver/owner `kit.tsx` implementation (grep the component name in `apps/driver/src/components/kit.tsx`) AND its customer equivalent (`apps/customer/components/ui/<Name>.tsx`, if it exists — some may only exist in one app; e.g. `StatTile` might be customer-only or driver/owner-only, verify). List every prop each version has that the other lacks, following the exact method the spec's Button section demonstrates. If a component exists in only ONE app, there's no reconciliation needed — move it as-is (still update its internal color/text field references per Task 1's renames).

- [ ] **Step 2: Write failing tests for each component** (TDD — one test file per component, following `Button.test.tsx`'s established pattern from Task 2: renders correctly, covers each variant/tone that exists, covers the union of both apps' props if reconciled)

- [ ] **Step 3: Implement each component** — real superset API per Step 1's findings, internal implementation moved from whichever app's version is more complete (or merged, if both have unique real logic worth keeping — not just unique props), with Task 1's field renames applied throughout.

- [ ] **Step 4: Run tests, confirm all pass**

```
npm run typecheck && npm run lint && npm test
```
(from `packages/ui`)

- [ ] **Step 5: Update `packages/ui/src/index.ts`** to export all 5 new components + their prop types.

- [ ] **Step 6: Update CHANGELOG.md**

```
- HH:MM IST · **feat(ui): add the remaining shared primitives (Text, Card, Badge, Input, StatTile)** — each reconciled against both driver/owner's and customer's existing versions per the same superset-API method as Button; [note here which components existed in only one app and needed no reconciliation, if any]. packages/ui's primitive set is now complete for the 3 mobile apps' migration (Tasks 4-6). → `packages/ui/src/{Text,Card,Badge,Input,StatTile}.tsx`
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui CHANGELOG.md
git commit -m "feat(ui): add the remaining shared primitives (Text, Card, Badge, Input, StatTile)"
```

---

### Task 4: Migrate `apps/driver` to `@blue-bee/ui`

**Files:**
- Delete: `apps/driver/src/components/kit.tsx`, `apps/driver/src/theme.ts`, `apps/driver/src/components/haptics.ts`
- Modify: every file in `apps/driver/src` that imports from `'../theme'`, `'./kit'`, `'./haptics'`, or equivalent relative paths (find via `grep -rl "from '.*theme'\|from '.*kit'\|from '.*haptics'" apps/driver/src`)
- Modify: `apps/driver/package.json` (add `@blue-bee/ui` as a dependency)

**Interfaces:**
- Consumes: everything Tasks 2-3 exported from `packages/ui`.
- Produces: no new interface — this task is pure consumption/repointing.

- [ ] **Step 1: Add the dependency**

Add `"@blue-bee/ui": "*"` (or whatever version-range convention `apps/driver/package.json` already uses for its OTHER `@blue-bee/*` workspace dependencies — check and match exactly) to `apps/driver/package.json`. Run `npm install` from the repo root.

- [ ] **Step 2: Find every affected file**

```
grep -rl "from '\.\./theme'\|from '\./theme'\|from '\.\./components/kit'\|from '\./kit'\|from '\.\./components/haptics'\|from '\./haptics'" apps/driver/src
```

- [ ] **Step 3: Repoint every import**

For each file found, change the import source to `'@blue-bee/ui'` and update any field-name references per Task 1's renames (`textMuted`→`textSecondary`, `textFaint`→`textTertiary`, `azureInk`→`onAzureTint`, etc.) if that file reads `.color.<oldName>` directly rather than through a component that already handles the rename internally.

- [ ] **Step 4: Delete the now-unused local files**

```bash
git rm apps/driver/src/components/kit.tsx apps/driver/src/theme.ts apps/driver/src/components/haptics.ts
```

- [ ] **Step 5: Run driver's full test suite**

```
npx jest --runInBand
```
(from `apps/driver`) — fix every failure. A failure here means either a missed import repoint (Step 3 missed a file) or a field-rename that wasn't applied somewhere — not a reason to modify `packages/ui`'s API to paper over it, unless the failure reveals a genuine capability Task 2/3 missed (in which case, fix `packages/ui`, not just this app, and note it in the report).

- [ ] **Step 6: Run typecheck + lint**

```
npx tsc --noEmit && npx eslint . --ext .ts,.tsx --max-warnings=0
```
(from `apps/driver`)

- [ ] **Step 7: Update CHANGELOG.md**

```
- HH:MM IST · **refactor(driver): migrate to @blue-bee/ui** — deleted the local kit.tsx/theme.ts/haptics.ts (previously byte-identical to owner's copies); now imports the shared package. Zero behavior change except the Royal Dry Cleaning color update already approved. → `apps/driver/src/**`
```

- [ ] **Step 8: Commit**

```bash
git add apps/driver CHANGELOG.md
git commit -m "refactor(driver): migrate to the shared @blue-bee/ui component library"
```

---

### Task 5: Migrate `apps/owner` to `@blue-bee/ui`

**Files:** identical shape to Task 4, applied to `apps/owner`.

Since driver and owner's `kit.tsx`/`theme.ts`/`haptics.ts` were byte-identical BEFORE this migration, and Task 4 already worked out every field-rename/import-repoint needed, this task should be nearly mechanical — repeat Task 4's exact steps against `apps/owner/src` instead of `apps/driver/src`. If owner's actual call sites of these files have diverged from driver's in ways Task 4 didn't anticipate (e.g., owner uses a prop combination driver never did), handle it the same way Task 4's Step 5 instructs: fix `packages/ui` if it's a genuine missing capability, don't paper over it in the app.

- [ ] **Step 1: Add the dependency** (same as Task 4 Step 1, for `apps/owner/package.json`)
- [ ] **Step 2: Find every affected file** (same grep, against `apps/owner/src`)
- [ ] **Step 3: Repoint every import + apply field renames**
- [ ] **Step 4: Delete `apps/owner/src/components/kit.tsx`, `apps/owner/src/theme.ts`, `apps/owner/src/components/haptics.ts`**
- [ ] **Step 5: Run owner's full test suite** (`npx jest --runInBand` from `apps/owner`)
- [ ] **Step 6: Run typecheck + lint**
- [ ] **Step 7: Update CHANGELOG.md**

```
- HH:MM IST · **refactor(owner): migrate to @blue-bee/ui** — same migration as driver (Task 4); owner's kit.tsx/theme.ts/haptics.ts were byte-identical to driver's pre-migration copies. → `apps/owner/src/**`
```

- [ ] **Step 8: Commit**

```bash
git add apps/owner CHANGELOG.md
git commit -m "refactor(owner): migrate to the shared @blue-bee/ui component library"
```

---

### Task 6: Migrate `apps/customer`'s overlapping primitives to `@blue-bee/ui`

**Files:**
- Delete: `apps/customer/components/ui/{Button,Card,Badge,Input}.tsx` (the ones confirmed overlapping — verify this exact list against Task 3's actual findings before deleting anything; if Task 3 found StatTile or Text also overlaps with a customer equivalent, add those here too, or if one of Button/Card/Badge/Input turns out NOT to have a real customer equivalent, drop it from this list)
- Modify: `apps/customer/components/ui/index.ts` (update its re-exports)
- Modify: every file importing the deleted components from `apps/customer/components/ui`
- Modify or delete: `apps/customer/theme/theme.ts` (see Step 5 — the spec left `glass`/`blurTint`'s fate as an open item; resolve it now)
- Modify: `apps/customer/package.json` (add `@blue-bee/ui` dependency)

**Interfaces:**
- Consumes: `packages/ui`'s exports.
- Produces: none new — customer's specialized components (`Hero`, `BeeMark`, `Glass`, `IconBadge`, `KeyValue`, `Skeleton`, `Stepper`, `SectionHeader`, `Sheet`) stay in `apps/customer/components/ui/` unchanged in their own logic, but now read theme values through `@blue-bee/ui`'s `useTheme()` instead of customer's own local `theme.ts`.

- [ ] **Step 1: Add the dependency**

Same pattern as Task 4 Step 1, for `apps/customer/package.json`.

- [ ] **Step 2: Resolve `glass`/`blurTint`'s fate**

Per the spec's Open Items: check whether Task 4/5 (driver/owner) added any frosted-glass UI in the meantime (they shouldn't have — out of scope for those tasks — but verify by grepping `expo-blur` in `apps/driver/src` and `apps/owner/src`). If still unused outside customer: create a small `apps/customer/theme/glass.ts` that imports `useTheme` from `@blue-bee/ui` and adds just the `glass`/`blurTint` fields customer's specialized `Glass.tsx` component needs, rather than keeping customer's entire old `theme.ts` alive for two fields. If driver/owner have grown a real glass-UI need by this point, promote `glass`/`blurTint` to `packages/ui`'s `ColorScale` instead (requires a small Task 1/2 follow-up — flag this rather than doing it silently mid-Task-6 if it happens).

- [ ] **Step 3: For each overlapping primitive (per Task 3's findings), repoint customer's imports**

Find every file importing the old local component (`grep -rl "from '.*components/ui/Button'\|from '.*components/ui/Card'\|..."  apps/customer`) and repoint to `@blue-bee/ui`. Check each call site against the RECONCILED prop API (e.g., if customer previously called its own `Button` with just `variant` meaning what the shared version now calls `tone`+`variant` combined, update the call site to pass both props correctly — this is exactly the kind of call-site fix Task 2's Button reconciliation was designed to make possible without dropping capability, but the call sites still need the mechanical update).

- [ ] **Step 4: Delete the now-unused local component files + `theme.ts`** (keeping `glass.ts` per Step 2)

```bash
git rm apps/customer/components/ui/Button.tsx apps/customer/components/ui/Card.tsx apps/customer/components/ui/Badge.tsx apps/customer/components/ui/Input.tsx
# adjust this list to match Task 3's actual reconciliation findings
git rm apps/customer/theme/theme.ts
```

Update `apps/customer/components/ui/index.ts` to remove the deleted files' re-exports and (if useful for call-site convenience) re-export the `@blue-bee/ui` equivalents from the same barrel file, so files importing `from '../components/ui'` (the barrel) don't all need individual repointing — check whether customer's codebase actually imports individual files directly or always through the barrel `index.ts`, and choose the lower-effort repoint path based on that reality.

- [ ] **Step 5: Run customer's full test suite**

```
npx jest --runInBand
```
(from `apps/customer`) — fix every failure per the same principle as Task 4 Step 5.

- [ ] **Step 6: Run typecheck + lint**

- [ ] **Step 7: Update CHANGELOG.md**

```
- HH:MM IST · **refactor(customer): migrate overlapping primitives to @blue-bee/ui** — Button/Card/Badge/Input (or [actual final list]) now come from the shared package; customer's specialized components (Hero, BeeMark, Glass, IconBadge, KeyValue, Skeleton, Stepper) stay local but read theme values through @blue-bee/ui. [Note glass/blurTint's resolution from Step 2.] Closes the color-drift finding from the 2026-09-08 review — all three mobile apps now read from one canonical, Royal-Dry-Cleaning-branded token source. → `apps/customer/**`
```

- [ ] **Step 8: Commit**

```bash
git add apps/customer CHANGELOG.md
git commit -m "refactor(customer): migrate overlapping primitives to @blue-bee/ui, resolve theme.ts duplication"
```

---

### Task 7: Wire `apps/web`'s Tailwind config to the shared token values

**Files:**
- Modify: `apps/web/tailwind.config.js` (or `.ts` — check actual extension)
- Modify: `apps/web/package.json` (add `@blue-bee/design-tokens` dependency)
- Possibly modify: `apps/web/components/ui.tsx` if any hard-coded hex value there should now reference the shared preset's class names instead (investigate — see Step 2)

**Interfaces:**
- Consumes: `packages/design-tokens`'s `tailwindPreset` (Task 1's renamed version).
- Produces: no new interface — web's own component code (`ui.tsx`) stays as-is per the spec's Non-Goals (no component sharing); only the Tailwind theme values change.

- [ ] **Step 1: Add the dependency**

Add `"@blue-bee/design-tokens": "*"` to `apps/web/package.json` (matching whatever version-range convention its other `@blue-bee/*` deps use). `npm install` from the repo root.

- [ ] **Step 2: Investigate `apps/web`'s current Tailwind color setup**

Read `apps/web/tailwind.config.js` in full — does it currently define its OWN color palette inline (likely, given the "Daylight" comment in `ui.tsx` referencing "tailwind.config + globals.css")? Read `apps/web/app/globals.css` (or wherever CSS variables/dark-mode overrides live) too. Determine whether web's current colors ALREADY happen to match the old (pre-rebrand) Blue Bee blue, the NEW Royal Dry Cleaning blue, or something else entirely — this determines how big a visual change wiring the preset in actually is for web specifically (the spec assumed drift existed but didn't verify web's exact current values during planning — verify now).

- [ ] **Step 3: Wire the preset**

Add `presets: [require('@blue-bee/design-tokens').tailwindPreset]` to `tailwind.config.js`'s config object (per the preset file's own documented usage pattern). Remove web's own hand-maintained duplicate color definitions for any value now provided by the preset (don't leave two competing sources for the same Tailwind color token — that would silently un-fix the exact drift problem this whole project exists to close). Preserve web's dark-mode CSS-variable layering approach (the preset's own doc comment says dark mode is "layered on by web via the dark: variant or CSS variables in a later reconciliation pass" — check whether web already has a working dark-mode approach today and keep it working, just repointed at the preset's light values as the base rather than web's own hand-copied ones).

- [ ] **Step 4: Run web's full test suite + a visual smoke check**

```
npx jest --runInBand
```
(from `apps/web`). Since Tailwind class names might shift (e.g., if web currently uses a class name the preset doesn't produce), also run `npm run build` (or `next build`) to catch any Tailwind class resolution failure at build time, not just at test time — this is the one place in this whole plan where a broken color reference could silently compile fine but render unstyled in the browser, since Tailwind's JIT compiler doesn't typecheck class name strings.

- [ ] **Step 5: Update CHANGELOG.md**

```
- HH:MM IST · **refactor(web): wire the Tailwind config to the shared design-tokens preset** — the console's colors now come from the same canonical, Royal-Dry-Cleaning-branded source as the 3 mobile apps (values only — no component code sharing, since web is React DOM and the apps are React Native). [Note whatever Step 2 found about web's actual prior color values.] Completes the design-system consolidation from docs/superpowers/specs/2026-09-08-shared-ui-design-tokens-design.md. → `apps/web/tailwind.config.js`
```

- [ ] **Step 6: Commit**

```bash
git add apps/web CHANGELOG.md
git commit -m "refactor(web): wire Tailwind config to the shared design-tokens preset"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** all 6 migration steps from the design spec have a task (Task 1 = spec step 1, Task 2+3 = spec step 2 split into theme/Button-worked-example + the remaining primitives batch, Tasks 4-6 = spec steps 3-5, Task 7 = spec step 6).
- **Known ordering hazard, flagged explicitly in-line:** Task 2's `Button` depends on a `Text` component the plan originally assigned to Task 3 — Task 2's own Step 6 and Task 3's own header both flag this and instruct whichever task runs first to build a real (non-stub) `Text` rather than leaving a broken import. This is the one place this plan has a soft ordering dependency the writing-plans self-review caught; resolved by explicit instruction rather than reordering the whole task list, since Button was already the fully-worked-out example and re-deriving it after Text would cost more than handling the dependency inline.
- **Open investigative items are intentional, not vagueness:** Task 1 Step 4 (exact `FontSizeToken` shape), Task 2 Step 1 (Metro/dist consumption pattern), Task 3 Step 1 (per-component prop diffs beyond Button), and Task 7 Step 2 (web's actual current color values) are all real unknowns as of this plan's writing that need a fresh read of live source to resolve correctly — each names exactly what to read and what decision the reading resolves, rather than leaving a bare "figure it out."
- **Task independence:** Tasks 4, 5 are independent of each other (both depend only on Tasks 2+3). Task 6 depends on Tasks 2+3 and benefits from Task 4's repoint work being done first (same mechanical pattern) but doesn't strictly require it. Task 7 is independent of Tasks 4-6 entirely (web never touches `packages/ui`). Task 1 blocks everything. Tasks 2-3 block 4-7.
