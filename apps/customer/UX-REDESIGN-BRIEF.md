# Customer App — UI/UX Redesign Brief (for Claude Code)

**Working folder:** `/Volumes/Gowtham/Blue Bee/apps/customer`
**Goal:** Restyle the customer app to match the founder's reference screenshots. Presentation only.
**Hard rule:** Do NOT change how the app talks to the backend. Every screen must keep calling the same API methods and rendering the same data — only the *look* changes. If the backend was connected before your change, it must be connected after.

Work on a branch: `git checkout -b feature/customer-ux`. Commit per screen.

---

## 1. FROZEN — do not touch (this is what keeps frontend ↔ backend connected)
- `src/api/*` — `customer-client.ts`, `types.ts` (the transport + DTO types)
- `src/session/*` — `SessionProvider` (auth/session; `useSession()` → `{ client, me, status }`)
- `src/navigation.ts` — `RootStackParamList` **param shapes**, `navigationRef`, `openOrderTracking`
- `src/push/*`, `src/config.ts`
- `@blue-bee/api-client`, `@blue-bee/shared`
- Inside each screen: the data-loading logic — `useSession()`, every `client.<method>()` call, the `useState/useCallback/useFocusEffect` wiring, and `src/format.ts` helpers. **Keep the calls and the state; restyle only what's rendered.**

If a redesign seems to need a new field or endpoint, STOP and flag it — do not invent one.

## 2. TOUCH — the redesign surface
- `theme/` — the design tokens (`colors`, `space`, type scale, radii, shadows) + the anim hooks (`usePressScale`, `useEntrance`). **This is the highest-leverage file — evolve token *values* here first.**
- `components/ui/` — the shared primitives (`Text`, `Button`, `Card`, `StatusPill`, `EmptyState`, `SkeletonCard`, `BeeMark`). Restyle these; add new primitives here if a screen needs one.
- `src/screens/*` — layout/composition only (spacing, hierarchy, grouping, new presentational sub-components). Leave the data hooks alone.

## 3. Method (order matters)
1. **Inventory (do this first, read-only):** for each of the 8 screens below, note the exact `client.*` call(s) and the `../api/types` types it renders. This is the contract you preserve. Screens:
   `LoginScreen · OrdersScreen · BookScreen · OrderDetailScreen · TrackScreen · ChatScreen · PayScreen · SettingsScreen`
   (Confirmed example — `OrdersScreen` calls `client.listOrders({ limit })` → `OrderSummary[]`, and renders loading / error / empty / list states. Every state must survive the redesign.)
2. **Tokens from the screenshots:** extract the reference look into `theme/` — palette, type scale, spacing, corner radius, shadows, light/dark. Do NOT hard-code colors in screens; everything reads from `useTheme()`.
3. **Primitives:** update `components/ui/` to the new look (Card elevation, Button shape/states, StatusPill colors, Text scale). Because screens already compose these, this does most of the visual work.
4. **Pilot one screen — `OrdersScreen`** (the landing screen; it exercises Text, Button, Card, StatusPill, EmptyState, SkeletonCard + loading/error/empty). Get it pixel-right against the reference, confirm data still loads.
5. **Roll the pattern** across the other 7 screens.

## 4. Preserve every screen state
For each screen keep and restyle ALL of: **loading** (skeletons), **error** (retry), **empty** (CTA), and **data** states. A redesign that only styles the happy path is incomplete.

## 5. Dev loop (no 1–2 hr rebuilds)
Build the dev client **once**, then hot-reload:
```bash
cd "/Volumes/Gowtham/Blue Bee/apps/customer" && nvm use 20
eas build --profile development --platform android      # once (~1–2 hrs) → install on phone
EXPO_PUBLIC_API_BASE_URL=https://api-production-d45a.up.railway.app npx expo start --dev-client --tunnel
```
Every save reloads on the phone in ~1s against the live Railway API + seeded data. Only build a `preview`/`production` APK at the very end.

## 6. QA gate before "done" on each screen
- Screen renders the reference look in light AND dark.
- Data still loads live (real seeded orders show up) — backend intact.
- Loading / error / empty states all restyled and working.
- No new `client.*` call, no changed navigation param, no edited file from section 1.
- `npx tsc --noEmit` clean; existing screen tests still green (`npm test`).
