# Blue Bee — Design Language ("Daylight")

> The canonical design system for every Blue Bee surface: the **web console** (Next.js + Tailwind)
> and the three **Expo apps** (`customer`, `owner`, `driver`). This document is the system of record;
> its machine-readable counterpart is the **[`@blue-bee/design-tokens`](../../packages/design-tokens/)**
> package. The two must stay in lock-step — if a value changes here, change it there, and vice-versa.

Blue Bee is a logistics & chain-of-custody product for the GTA: people use it on a phone in a van, at
a plant station, at a care-home nurse's desk, and at a console all day. The design language exists to
make those screens **calm, legible, trustworthy, and fast** — premium without being precious, and
honest about state (this is software people make liability decisions on).

---

## 1. Principles

The system has seven principles. When a decision is ambiguous, these are the tie-breakers — in order.

### 1.1 Content-first
The data is the interface. Chrome recedes; the order, the route, the resident's garments, the live
truck are what's bright and large. We do not decorate empty space — we use whitespace and hierarchy so
the eye lands on the one thing that matters on each screen. Lead with the answer, not the dashboard.

### 1.2 Depth, not decoration
Elevation communicates **relationship and focus**, never ornament. A card lifts because it's
interactive; a sheet floats because it's modal. Shadows are cool, soft, and low-spread (see §6).
Gradients, glows, and faux-3D are off-limits. In dark mode, depth comes from the surface steps
(canvas → subtle → surface), not heavier shadows.

### 1.3 Restraint with color
One brand blue does the work. Color is **meaning**: azure = the action, honey = attention/marking,
success / warning / danger = state. Tints (the soft backgrounds) carry status without shouting. A
screen that is mostly neutral with a single confident blue reads as more premium — and more
legible — than a rainbow. Never use color as the *only* signal (see §8 accessibility).

### 1.4 Tactile & haptic
Touch targets feel physical: a press has a visible state change and, on mobile, a haptic. Motion is
quick and spring-driven so the UI feels like it has weight and momentum, not like slides. Gestures
(swipe to advance a stop, pull to refresh a route) are first-class on the apps.

### 1.5 Honest states
Every screen has a real **loading**, **empty**, **partial**, **error**, and **offline** state — and
they tell the truth. We never fake a number, a capacity, a certification, or a "delivered" we can't
prove. A pending upload says pending; a stale GPS fix shows its age; an estimate is labelled an
estimate. Skeletons mirror the real layout (no spinners-over-everything). This is the visual arm of
the **honesty firewall** (CLAUDE.md): the UI must not present demo or estimated data as confirmed fact.

### 1.6 Adaptive
One language, every surface. The same tokens drive Tailwind on web and the StyleSheet/Reanimated
layer on Expo. Layouts are responsive (phone → tablet → wide console) and respect platform
conventions (iOS/Android safe areas, native sheets, system back). Light and dark are both
first-class, not an afterthought.

### 1.7 Accessible is premium
Accessibility is a quality bar, not a compliance checkbox. Text contrast meets **WCAG AA**
(≥ 4.5:1 body, ≥ 3:1 large); focus is always visible (the `focus` ring, §6); targets are ≥ 44×44pt;
nothing relies on color alone; motion respects `prefers-reduced-motion`; everything is reachable by
keyboard and screen reader. A product nurses, drivers, and finance staff use all day *must* be
comfortable.

---

## 2. Color

Two complete scales — **light** (default) and **dark** — carrying the **Royal Dry Cleaning** brand
(the crest's royal blue = `azure`, the crown's gold = `honey`). Semantics are identical across modes;
only the values change. Source of truth: `color.light` / `color.dark` in the tokens package. Naming
(`azure`/`honey`, not generic `primary`/`accent`) matches what's already live in production across all
three mobile apps — see `docs/superpowers/specs/2026-09-08-shared-ui-design-tokens-design.md` for the
reconciliation history.

### 2.1 Light

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#F4F6FB` | App/page background |
| `subtle` | `#EAEFF7` | Recessed background (grouped rows, inset panels) |
| `surface` | `#FFFFFF` | Cards, sheets, inputs |
| `surfacePressed` | `#EEF3FA` | Pressed/active surface tint (list rows, buttons mid-press) |
| `hairline` | `#E4E9F2` | 1px borders / separators |
| `text` | `#0A2540` | Primary text, headings |
| `textSecondary` | `#5A6B82` | Secondary text, labels |
| `textTertiary` | `#8A99AE` | Hints, disabled, metadata |
| `azure` | `#1E50C8` | Brand primary — the crest's royal blue |
| `azureTint` | `#E7ECFB` | Selected chips, info cards, marker halo |
| `honey` | `#DDA82E` | Brand accent — the crown's gold |
| `honeyTint` | `#FAF3DF` | Honey wash |
| `success` | `#14B86A` | Delivered, paid, healthy |
| `successTint` | `#E5F8EE` | Success background |
| `warning` | `#F59E0B` | At-risk, due-soon, on-hold |
| `warningTint` | `#FEF3E2` | Warning background |
| `danger` | `#E5484D` | Failed, overdue, claims, destructive |
| `dangerTint` | `#FDECEC` | Danger background |
| `onAzure` | `#FFFFFF` | Text drawn ON a solid azure fill |
| `onHoney` | `#3D2C00` | Text drawn ON a solid honey fill |
| `onAzureTint` | `#1E50C8` | Legible text on `azureTint` |
| `onSuccessTint` | `#0A7C46` | Legible text on `successTint` |
| `onWarningTint` | `#8A5300` | Legible text on `warningTint` |
| `onDangerTint` | `#C42A1F` | Legible text on `dangerTint` |
| `onHoneyTint` | `#7A5800` | Legible text on `honeyTint` |
| `scrim` | `rgba(10,37,64,0.45)` | Modal scrim behind sheets |
| `skeleton` | `#E9EEF5` | Skeleton loading-state base |
| `skeletonHighlight` | `#F4F7FB` | Skeleton loading-state highlight |

### 2.2 Dark

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#0A0E1A` | App/page background |
| `subtle` | `#111728` | Recessed background |
| `surface` | `#141B2D` | Cards, sheets, inputs |
| `surfacePressed` | `#1B2438` | Pressed/active surface tint |
| `hairline` | `rgba(255,255,255,0.08)` | 1px borders / separators |
| `text` | `#EAF0F8` | Primary text |
| `textSecondary` | `#9DB0C9` | Secondary text |
| `textTertiary` | `#6B7C96` | Hints, disabled |
| `azure` | `#5B87F5` | Brand primary |
| `azureTint` | `rgba(91,135,245,0.18)` | Selected chips, info cards, marker halo |
| `honey` | `#E8B84D` | Brand accent |
| `honeyTint` | `rgba(232,184,77,0.16)` | Honey wash |
| `success` | `#2DD583` | Delivered, paid, healthy |
| `successTint` | `rgba(45,213,131,0.16)` | Success background |
| `warning` | `#FFC34D` | At-risk, due-soon |
| `warningTint` | `rgba(255,195,77,0.16)` | Warning background |
| `danger` | `#FF6168` | Failed, overdue, claims |
| `dangerTint` | `rgba(255,97,104,0.16)` | Danger background |
| `onAzure` | `#FFFFFF` | Text drawn ON a solid azure fill |
| `onHoney` | `#241A00` | Text drawn ON a solid honey fill |
| `onAzureTint` | `#5B87F5` | Legible text on `azureTint` |
| `onSuccessTint` | `#2DD583` | Legible text on `successTint` |
| `onWarningTint` | `#FFC34D` | Legible text on `warningTint` |
| `onDangerTint` | `#FF6168` | Legible text on `dangerTint` |
| `onHoneyTint` | `#E8B84D` | Legible text on `honeyTint` |
| `scrim` | `rgba(0,0,0,0.6)` | Modal scrim behind sheets |
| `skeleton` | `#1B2438` | Skeleton loading-state base |
| `skeletonHighlight` | `#222D45` | Skeleton loading-state highlight |

> `onXTint` fields are the legible foreground for text drawn ON that status's pale tint background —
> in light mode these are deep shades of the hue (the bright semantic color fails contrast on its own
> tint); in dark mode they're the bright hue (reads fine on the dark translucent tint). Use the bright
> `success`/`warning`/`danger`/`honey`/`azure` values only for fills, icons, dots, and borders — never
> for text on the matching tint. RN has no hover state, and web's own press/hover states live in its
> own component layer (`apps/web/components/ui.tsx`) independent of this shared scale — so there are
> no `*Hover`/`*Active` fields here; don't invent them.

### 2.3 Status → color mapping (canonical)

| Domain state | Color |
| --- | --- |
| Delivered · Paid · Completed · On-time · Reconciled | `success` |
| En-route · Scheduled · In-progress · Active | `azure` |
| Due soon · On-hold · At-risk · Pending approval | `warning` |
| Failed · Overdue · Claim · Lost · Damage flagged | `danger` |
| Draft · Closed · Inactive · Archived | neutral text + `subtle` bg |

---

## 3. Spacing

An **8pt rhythm** with 2/4px half-steps for tight optical adjustments. Use the scale; don't hand-roll
arbitrary pixels.

| Token | px | | Token | px |
| --- | --- | --- | --- | --- |
| `0` | 0 | | `5` | 20 |
| `0.5` | 2 | | `6` | 24 |
| `1` | 4 | | `8` | 32 |
| `2` | 8 | | `10` | 40 |
| `3` | 12 | | `12` | 48 |
| `4` | 16 | | `16` | 64 |

Guidance: `2`–`3` inside controls, `4` between related elements, `6` between groups, `8`+ for section
gaps and screen padding.

---

## 4. Radius

| Token | px | Use |
| --- | --- | --- |
| `xs` | 6 | Chips, small inputs |
| `sm` | 10 | Buttons, inputs |
| `md` | 12 | Cards, list rows |
| `lg` | 16 | Large cards, tiles |
| `xl` | 20 | Sheets, modals |
| `2xl` | 28 | Hero surfaces, prominent sheets |
| `pill` | 999 | Pills, badges, avatars, FABs |

---

## 5. Typography

A semantic ramp — pick by **role**, not by size. Each role is `{ size, lineHeight, weight, tracking }`
(px / px / numeric weight / em tracking). The system font stack (SF Pro / Inter / Roboto by platform)
keeps it native and legible.

| Role | Size | Line | Weight | Tracking | Use |
| --- | --- | --- | --- | --- | --- |
| `display` | 34 | 40 | 700 | -0.02 | Big numbers, landing hero |
| `title1` | 28 | 34 | 700 | -0.02 | Screen title |
| `title2` | 22 | 28 | 600 | -0.01 | Section title |
| `title3` | 20 | 26 | 600 | -0.01 | Card title |
| `headline` | 17 | 22 | 600 | 0 | Emphasis / row title |
| `body` | 16 | 24 | 400 | 0 | Body copy |
| `subhead` | 15 | 20 | 500 | 0 | Labels, sub-row |
| `footnote` | 13 | 18 | 400 | 0 | Secondary metadata |
| `caption` | 12 | 16 | 500 | 0.01 | Badges, timestamps, hints |
| `overline` | 12 | 16 | 700 | 0.7 | Section eyebrows / uppercase kickers |

---

## 6. Elevation & focus

Shadows are tuned for the light canvas (cool tint `rgba(10,37,64,…)`, soft, low-spread). Use the
ramp to signal **state**, not to decorate.

| Token | Value | Use |
| --- | --- | --- |
| `e1` | `0 1px 2px rgba(10,37,64,.06), 0 1px 3px rgba(10,37,64,.04)` | Cards at rest |
| `e2` | `0 4px 12px rgba(10,37,64,.08)` | Hovered cards, popovers |
| `e3` | `0 12px 32px rgba(10,37,64,.14)` | Sheets, modals, menus |
| `focus` | `0 0 0 3px rgba(11,95,255,.35)` | Focus ring (always visible) |

> Dark mode uses the surface steps for elevation; reserve shadows for true overlays only.

---

## 7. Motion

Short, content-respecting, spring-driven. Honor `prefers-reduced-motion` (drop to a fast cross-fade
or none).

| Group | Token | Value |
| --- | --- | --- |
| Durations (ms) | `fast` / `base` / `slow` / `sheet` | 120 / 200 / 320 / 400 |
| Easing | `standard` | `cubic-bezier(.2,.8,.2,1)` |
| Easing | `emphasized` | `cubic-bezier(.16,1,.3,1)` |
| Spring (RN) | `damping` / `stiffness` / `mass` | 18 / 180 / 1 |

Use `standard` for most UI moves, `emphasized` for entrances and sheet presentations, and the spring
for gesture-driven motion (swipes, drags) on the apps.

---

## 8. State patterns (the honest-states contract)

Every data surface implements all of these — they are not optional polish:

- **Loading** — skeletons that mirror the real layout (not a spinner over the page). Show structure.
- **Empty** — a plain, helpful zero-state with the next action; never a fake row.
- **Partial / stale** — show what we have and *label what we don't*: "ETA (estimate)", "GPS 2m ago",
  "photo uploading…". Estimates and demo data are visibly marked.
- **Error** — say what failed and the recovery; map server `problem+json` to human copy. Never swallow.
- **Offline** — the driver/plant surfaces work offline-first: queued actions show a pending badge and
  reconcile on sync. Stop status is authoritative over raw GPS.

---

## 9. Component conventions (applying the tokens)

- **Buttons** — `sm` radius; primary = `azure` bg / `onAzure` text (RN has no hover state; web's
  press/hover states live in its own component layer, not this shared scale); secondary = `surface` +
  `hairline` border; ghost = `azureTint` bg + `onAzureTint` text; pressed/active = `surfacePressed`.
  Min target 44×44pt. Disabled = `textTertiary` on `subtle`.
- **Cards / list rows** — `surface` on `canvas`, `md` radius, `e1` at rest, `1px hairline` where a
  border reads cleaner than a shadow. Lift to `e2` only when interactive/hovered; press state =
  `surfacePressed`.
- **Inputs** — `surface`, `hairline` border, `sm` radius, `focus` ring on focus, `danger` border +
  `caption` helper on error.
- **Badges / status pills** — `pill` radius, `caption` type, the matching `onXTint` foreground on its
  tint (e.g. `onSuccessTint` text on `successTint` bg), **plus a glyph or label** so it's never
  color-only.
- **Sheets / modals** — `surface`, `xl`–`2xl` radius (top corners on mobile sheets), `e3`, present
  with `emphasized` easing over `sheet` duration; backdrop is `scrim`, not a blur wall.
- **Maps / live tracking** — the vehicle, the stop, and the ETA range are the bright elements; the
  basemap is desaturated. Live = `azure`; show last-fix age honestly.
- **Skeletons** — `skeleton` base with a `skeletonHighlight` shimmer sweep, matching the real layout.

---

## 10. The anti-"vibe-coded" checklist

A screen is **not done** until every box is checked. This is what separates a real product from a
demo that *looks* like one.

- [ ] **Tokens only** — no raw hexes, magic pixel values, or one-off shadows in components. Every
      color/space/radius/shadow/duration comes from `@blue-bee/design-tokens`.
- [ ] **8pt rhythm** — all spacing is on the scale; nothing is `13px` "because it looked right".
- [ ] **Type by role** — text uses the ramp roles, not ad-hoc sizes/weights.
- [ ] **All five states** — loading (skeleton), empty, partial/stale, error, offline are all built
      and truthful (§8). No screen dies on empty or 1-row data.
- [ ] **Honest data** — nothing fabricated; estimates/demo/stale data are visibly labelled; numbers
      trace to a real source. (Honesty firewall.)
- [ ] **Contrast AA** — text and essential UI pass WCAG AA in **both** light and dark.
- [ ] **Not color-alone** — every status carries a label/icon as well as color.
- [ ] **Focus visible** — keyboard focus shows the `focus` ring everywhere; full keyboard reachability.
- [ ] **Targets ≥ 44pt** — touch targets and hit-slop are comfortable on a phone in a van.
- [ ] **Reduced motion** — animations degrade gracefully under `prefers-reduced-motion`.
- [ ] **Dark mode real** — checked in dark, not just inverted; depth via surface steps.
- [ ] **Responsive** — works phone → tablet → wide console; safe areas respected on native.
- [ ] **Loading ≠ layout shift** — skeletons match final layout; content doesn't jump in.
- [ ] **Copy is plain** — labels are human, errors are actionable, no lorem, no dev jargon in the UI.
- [ ] **Empty has a path** — every zero-state offers the next step.

---

## 11. Using the tokens

```ts
import { tokens, light, dark, space, radius, fontSize, shadow, motion, tailwindPreset } from '@blue-bee/design-tokens';
```

- **Web (Tailwind)** — adopt the preset later:
  `presets: [require('@blue-bee/design-tokens').tailwindPreset]`, then use `bg-surface`,
  `text-text`, `bg-azure`, `rounded-md`, `shadow-e1`, `text-title2`, etc.
- **Expo apps** — import the raw constants into the StyleSheet/theme layer and a Reanimated config
  (use `motion.spring` for gestures, `motion.durations` + `easing` for timed transitions).

> **Scope note for this branch:** the package is published, built, and tested here; wiring it into
> `apps/web` and the Expo apps is a deliberate later reconciliation pass. The reskin branches
> currently mirror these values locally — this document + the package are what they reconcile to.
