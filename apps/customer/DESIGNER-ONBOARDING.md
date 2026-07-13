# Blue Bee — Customer App: Designer Onboarding

Welcome. You're improving the **customer mobile app** (React Native + Expo). This doc gets you running against the live staging backend in ~30 minutes, shows you the three files that give you the most visual leverage, and tells you the few things that will break the product if you change them.

**You do not need to run the backend.** No Postgres, no Redis, no Docker. You point the app at our live staging API and get real data instantly.

---

## 1. Get it running

```bash
git clone https://github.com/onskim/blue-bee.git
cd blue-bee
nvm use 20            # Node 20 — other versions will fight you
npm install           # from the REPO ROOT (npm workspaces; do not npm install inside apps/customer)
```

The app uses native modules (Stripe, camera, maps), so **Expo Go will not work** — you need a *dev client* build, once:

```bash
cd apps/customer
npx eas build --profile development --platform android    # ~1–2 hrs, ONCE. Install the APK on your phone.
```

> Ask the founder for the existing dev-client build link first — EAS internal distribution means you can likely just install ours and skip the wait entirely.

Then, forever after, this is your loop:

```bash
cd apps/customer
EXPO_PUBLIC_API_BASE_URL=https://api-production-d45a.up.railway.app npx expo start --dev-client --tunnel
```

Every save hot-reloads on your phone in about a second, against real seeded data. **Only rebuild the dev client if you add a native dependency** — a pure restyle never needs another build.

### Logging in
Use a seeded demo customer: phone **`+14165550010`** (Rita Patel — she has real orders, addresses and an invite code). Staging accepts the dev code the API returns in the `POST /v1/auth/otp` response (and `000000` for seeded demo phones).

⚠️ That bypass exists on **staging only**, and it is a known, tracked item to remove before real customers. Don't rely on it for anything but development.

---

## 2. Where the visual leverage actually is

Work **top-down**. Most of the redesign happens in two files before you touch a single screen.

| Layer | Path | What it gives you |
|---|---|---|
| **1. Tokens** | [`theme/theme.ts`](theme/theme.ts) | Every colour, the type scale, spacing, radii, elevation, motion — for **both light and dark**. All 14 screens import from here. Change a value; the whole app changes. **Start here.** |
| **2. Primitives** | [`components/ui/`](components/ui/) | `Text · Button · Card · Badge · StatusPill · Input · Row · KeyValue · Sheet · Skeleton · EmptyState · Glass · BeeMark`. The screens are *composed* of these, so restyling them does most of the remaining work. |
| **3. Screens** | [`src/screens/`](src/screens/) | Layout and composition only — spacing, hierarchy, grouping. Leave the data hooks alone (see §3). |

**Never hard-code a colour in a screen.** Everything reads from `useTheme()`. Dark mode is a first-class requirement, not a nice-to-have: if it only looks right in light mode, it isn't done.

### The 14 screens
`LoginScreen` · `DashboardScreen` (the Home tab) · `HomeScreen` (the services grid) · `BookScreen` · `OrdersScreen` · `OrderDetailScreen` · `TrackScreen` · `PayScreen` · `ChatScreen` · `RateScreen` · `ReferScreen` · `AddressesScreen` · `AddressFormScreen` · `SettingsScreen`

Bottom nav is **Home · Services · Orders · Profile · Refer**.

---

## 3. FROZEN — the line you must not cross

This is what keeps the app connected to the backend. Full detail in [`UX-REDESIGN-BRIEF.md`](UX-REDESIGN-BRIEF.md) §1; the short version:

- **`src/api/*`** — the transport and DTO types.
- **`src/session/*`** — auth/session (`useSession()` → `{ client, me, status }`).
- **`src/navigation.ts`** — `RootStackParamList` **param shapes** (adding a screen is fine; changing an existing param's shape is not).
- **`src/push/*`, `src/config.ts`**, and anything in `@blue-bee/api-client` / `@blue-bee/shared`.
- **Inside each screen:** the data-loading logic — every `client.<method>()` call and its `useState`/`useCallback`/focus-refetch wiring. **Keep the calls and the state. Restyle only what's rendered.**

Also off-limits for this work: `apps/api`, `apps/web`, `apps/driver`, `prisma/`, `packages/shared`. If a design seems to need a new field or a new endpoint, **stop and ask** — don't invent one.

**Keep every `testID`.** They aren't cosmetic; the test suite navigates by them. Renaming one breaks a test, which is the system telling you a contract moved.

---

## 4. Every screen has four states. All four ship.

For each screen, keep and restyle **all** of:

1. **loading** (skeletons — `components/ui/Skeleton.tsx`)
2. **error** (with a retry that actually retries)
3. **empty** (with a CTA that goes somewhere useful)
4. **data**

A redesign that only styles the happy path is not finished. The empty and error states are where users are most anxious — they deserve the most care, not the least.

One specific behaviour to preserve: **a failed refresh must not blank working content.** If the user is looking at their orders and a refresh fails, they keep seeing their orders. We fixed this deliberately; please don't regress it.

---

## 5. The honesty rule (the one that gets people fired)

**Never invent data, prices, or claims — not even as placeholder copy.**

This is a real laundry business with real money in it, and this rule is enforced in code and in tests:

- ❌ No `"From $19.99"`, no `"4.9 ★ (2,341 reviews)"`, no `"Eco-certified"`, no `"12 drivers near you"`, no lorem-ipsum pricing. Not in a mockup that might get merged, not "just for now".
- ✅ Where the founder hasn't set a price, the card says **"Get a quote"** — because that is the truth. Design *that* state to look good; don't design a fake price to avoid it.
- ✅ Credit balances, order counts, ratings and prices all come from the server. If a number is on screen, it came from the API.
- The **Home tab's promo copy is server-owned** (the founder writes it in the web console). Don't hard-code text into `DashboardScreen` — style the card, not the words.

If a layout looks empty without invented content, that's a design problem to solve honestly (better empty state, better hierarchy), not a data problem to paper over. When in doubt, ask.

---

## 6. Your safety net — run these before every PR

From `apps/customer`:

```bash
npx tsc --noEmit     # types
npx jest             # 209 tests — they assert states, testIDs and behaviour
npm run lint
```

From the repo root, `npm run typecheck` and `npm run lint` check everything.

The tests are **for you, not against you**: they're how you know a restyle didn't quietly disconnect a screen from the backend. If a test fails, read it — it's usually telling you that a `testID` moved, a state disappeared, or a data call got dropped.

---

## 7. Workflow

```bash
git checkout -b feature/customer-ux-<what-you-are-doing>
# commit per screen, small and reviewable
git push -u origin feature/customer-ux-<what-you-are-doing>
# open a PR into main
```

`main` is the live app. Please don't push to it directly — open a PR.

**Suggested order** (highest leverage first):
1. Tokens in `theme/theme.ts` — palette, type scale, spacing, radii, elevation. Light **and** dark.
2. The `components/ui/` primitives.
3. Pilot **one** screen end-to-end (`OrdersScreen` is a good choice — it exercises Text, Button, Card, StatusPill, EmptyState, Skeleton and all four states). Get it right, confirm data still loads on the phone.
4. Roll the pattern across the rest.

---

## 8. Reference material

- [`UX-REDESIGN-BRIEF.md`](UX-REDESIGN-BRIEF.md) — the original brief (written for an AI agent, so it's terse; §1's frozen list and §4's state rules are the parts that still matter most). Note it predates the Home/Refer/Rate/Addresses screens — the 14 screens listed above are current.
- Reference screenshots of the target look exist but are **not in the repo** (19 MB of PNGs). Ask the founder to share them via Drive/Figma.
- Live staging console (to see what the founder can configure): `https://web-production-ba508.up.railway.app`

Questions, or something that seems to need a backend change: ask before building. A five-minute question beats a rebuilt screen.
