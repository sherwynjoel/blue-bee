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
One brand blue does the work. Color is **meaning**: primary = the action, accent = attention/marking,
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

Two complete scales — **light** (default) and **dark**. Semantics are identical across modes; only the
values change. Source of truth: `color.light` / `color.dark` in the tokens package.

### 2.1 Light

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#FBFCFE` | App/page background |
| `subtle` | `#F4F7FB` | Recessed background (grouped rows, inset panels) |
| `surface` | `#FFFFFF` | Cards, sheets, inputs |
| `hairline` | `#E5EAF1` | 1px borders / separators |
| `textPrimary` | `#0A2540` | Primary text, headings |
| `textSecondary` | `#5A6B82` | Secondary text, labels |
| `textTertiary` | `#8A99AE` | Hints, disabled, metadata |
| `primary` | `#0B5FFF` | Brand action |
| `primaryHover` | `#0A54E0` | Action hover |
| `primaryActive` | `#0848C2` | Action pressed |
| `primaryTint` | `#E8F0FF` | Selected rows, ghost-button bg |
| `accent` | `#FFB020` | Attention / flags / highlights |
| `accentTint` | `#FFF6E6` | Accent background |
| `success` | `#14B86A` | Delivered, paid, healthy |
| `successTint` | `#E5F7EE` | Success background |
| `warning` | `#F59E0B` | At-risk, due-soon, on-hold |
| `warningTint` | `#FFF4E0` | Warning background |
| `danger` | `#E5484D` | Failed, overdue, claims, destructive |
| `dangerTint` | `#FCEBEC` | Danger background |

### 2.2 Dark

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#0A0E1A` | App/page background |
| `subtle` | `#111728` | Recessed background |
| `surface` | `#141B2D` | Cards, sheets, inputs |
| `hairline` | `rgba(255,255,255,0.08)` | 1px borders / separators |
| `textPrimary` | `#EAF0F8` | Primary text |
| `textSecondary` | `#9DB0C9` | Secondary text |
| `textTertiary` | `#6B7C96` | Hints, disabled |
| `primary` | `#3D8BFF` | Brand action |
| `primaryTint` | `rgba(61,139,255,0.16)` | Selected rows, ghost-button bg |
| `accent` | `#FFC34D` | Attention / flags |
| `success` | `#2DD583` | Delivered, paid, healthy |
| `warning` | `#FFC34D` | At-risk, due-soon |
| `danger` | `#FF6168` | Failed, overdue, claims |

> Dark mode intentionally ships a smaller interaction set (no separate hover/active or per-status
> tints) — depth and state come from the surface steps + base status colors. Don't invent dark-mode
> hovers/tints; if the system needs them later, add them to the tokens first.

### 2.3 Status → color mapping (canonical)

| Domain state | Color |
| --- | --- |
| Delivered · Paid · Completed · On-time · Reconciled | `success` |
| En-route · Scheduled · In-progress · Active | `primary` |
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
| `sm` | 8 | Buttons, inputs |
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

- **Buttons** — `sm` radius; primary = `primary` bg / white text (hover `primaryHover`, active
  `primaryActive`); secondary = `surface` + `hairline` border; ghost = `primaryTint` bg. Min target
  44×44pt. Disabled = `textTertiary` on `subtle`.
- **Cards / list rows** — `surface` on `canvas`, `md` radius, `e1` at rest, `1px hairline` where a
  border reads cleaner than a shadow. Lift to `e2` only when interactive/hovered.
- **Inputs** — `surface`, `hairline` border, `sm` radius, `focus` ring on focus, `danger` border +
  `caption` helper on error.
- **Badges / status pills** — `pill` radius, `caption` type, status color on its tint (e.g.
  `success` on `successTint`), **plus a glyph or label** so it's never color-only.
- **Sheets / modals** — `surface`, `xl`–`2xl` radius (top corners on mobile sheets), `e3`, present
  with `emphasized` easing over `sheet` duration; backdrop is a low-opacity scrim, not a blur wall.
- **Maps / live tracking** — the vehicle, the stop, and the ETA range are the bright elements; the
  basemap is desaturated. Live = `primary`; show last-fix age honestly.

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
  `text-text-primary`, `rounded-md`, `shadow-e1`, `text-title2`, etc.
- **Expo apps** — import the raw constants into the StyleSheet/theme layer and a Reanimated config
  (use `motion.spring` for gestures, `motion.durations` + `easing` for timed transitions).

> **Scope note for this branch:** the package is published, built, and tested here; wiring it into
> `apps/web` and the Expo apps is a deliberate later reconciliation pass. The reskin branches
> currently mirror these values locally — this document + the package are what they reconcile to.
