# Blue Bee Customer App — "Daylight" reskin · screenshots

Branch: `design/customer-app`. This folder holds visual evidence for the premium reskin of `apps/customer`.

## Two kinds of artifact here

1. **`board-light.png` / `board-dark.png` and per-screen `*-light.png` / `*-dark.png`** — **DESIGN-REFERENCE RENDERS**, generated headlessly from the exact Daylight tokens (`apps/customer/theme/theme.ts`) via HTML + headless Chrome. They are a faithful, color-accurate preview of layout, type, color, and dark/light parity — **not** pixel captures from the running React Native app (the headless build env has no iOS Simulator / device, so true RN pixels can't be captured here — see the carry-forward note in the prompt). Treat them as the design intent.

2. **The real on-device captures** — to be taken by the founder on a Simulator/device (steps below). These are the authoritative product screenshots.

---

## Founder on-device capture steps (authoritative)

Prereqs: API running locally + seed data loaded (`npm run infra:up`, then the API with seed), and a `pk_test_…` Stripe key in `apps/customer/src/config.ts` (or `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`) for the Pay sheet.

```bash
cd "apps/customer"
npm install                 # resolves expo-haptics / expo-blur / @expo/vector-icons into the lockfile
npx expo run:ios            # or: npx expo start  → press i  (Simulator), or scan with Expo Go on a device
```

Capture each screen in **both** appearances. Toggle Light/Dark in the Simulator with **⌘⇧A** (Features ▸ Toggle Appearance), or Settings ▸ Developer ▸ Dark Appearance. Screenshot with **⌘S** (Simulator) or the device's screenshot gesture.

| Screen | How to reach it | File names |
|---|---|---|
| Login (bee moment) | Launch signed-out | `login-light.png` / `login-dark.png` |
| My orders (cards, pills, skeleton, empty) | Sign in (phone-OTP; dev code prefilled) | `orders-light.png` / `orders-dark.png` |
| Book a cleaning | Tap "Book a specialty cleaning" | `book-light.png` / `book-dark.png` |
| Order detail (timeline hero, quote) | Tap an order with a SENT quote | `order-detail-light.png` / `order-detail-dark.png` |
| **Track my truck (HERO)** | Open an order with an active stop → "Track my truck" | `track-my-truck-light.png` / `track-my-truck-dark.png` |
| Pay → receipt | Approve a quote → "Pay" → complete the test sheet | `pay-light.png` / `pay-dark.png` |
| Settings | Tap the gear in the My orders header | `settings-light.png` / `settings-dark.png` |

For the **hero** (Track): capture once while **live** (driver en route, ETA showing, marker pulsing) and once **arrived/approaching** if you can drive the seed that far — these show the glass ETA card, the §12.2 "sharing" indicator, and the animated marker best.

To capture the reconnecting/degraded affordance: kill the API socket mid-track (the screen stays on the last-known position with the "Reconnecting — showing last known" chip — never a blank screen).
