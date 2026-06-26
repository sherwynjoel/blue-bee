# apps/owner — Owner app (React Native + Expo SDK 51)

The owner's **executive cockpit** — deliberately *not* the full console on a phone (PRD §4.3 / §7C). The
3rd React Native surface, built on the proven seam (`packages/api-client` + a native `SecureTokenStore`
+ `react-native-maps` + `socket.io-client` + `expo-notifications`), on-rails with `apps/driver` /
`apps/customer`. **Server-authoritative**: the server aggregates, the app renders — no KPI/approval
business logic on the client. **Shipped in Increment 14a** (branch `inc14-owner-app`).

## What it does (PRD §7C)
- **C1 Live fleet** — every outbound vehicle on a real map. `GET /fleet/live` is the **source of truth**,
  refined by `WS /live/fleet` (access JWT in the handshake auth); **degrades to REST polling** if the
  socket drops — never blank. Tap a truck → its route → stops → order.
- **C2 Today** — one glanceable screen: orders today, in flight, completed today, GMV approved today,
  cash collected today, on-time %, and the two attention counts. Auto-refresh on focus + pull-to-refresh.
- **C3 Approvals** — pending quote approvals; approve/decline on the order via the proven
  `POST /orders/:id/quote:approve|:decline` (server-authoritative; a **409 re-syncs** to the truth).
- **C4 Exceptions** — failed/skipped stops, held orders, open disputes, failed payments — newest first,
  each deep-linking to the underlying object.
- **C5 Drill-through** — read-only into the same objects the console shows (order + **chain of custody**).
- **Push** — `expo-notifications` token → `POST /device-tokens` on login; the owner receives
  exception/dispute alerts (Inc 14a adds PUSH to the `PAYMENT_DISPUTE` matrix). A tapped push
  deep-links to the order, **scoped** (the read is OWNER-/org-scoped server-side).

## Auth + RBAC
Phone-OTP via the shared `useAuthSession` (`@blue-bee/api-client`). The shell gates
**loading → login → no-access (non-owner token) → cockpit**. RBAC is also enforced **server-side**:
every owner read is `@Roles(RoleType.OWNER)` and org-scoped — a non-owner token gets **403**.

## The thin additive backend (Increment 14a, `apps/api/src/owner`)
Three OWNER-scoped reads that did not exist in the as-built (additive, no schema change, e2e-locked,
mirrors the Inc-11 `CatalogModule`): `GET /v1/owner/today`, `/owner/approvals`, `/owner/exceptions` —
all aggregated server-side over the proven row-scoping Prisma client. Everything else reuses proven
endpoints (`/fleet/live` + `WS /live/fleet`, `quote:approve|:decline`, `/orders/:id`, `/routes/:id`,
`/device-tokens`). The as-built supports **quote** approvals only — there is no threshold/claims/credits
approval object, so the cockpit surfaces pending quote approvals (what an owner can actually act on),
and low-par alerts stay modeled-for (Phase 2). See `AS-BUILT-MAP.md` for the per-screen endpoint/role map.

## Run / verify
- Dev: `npm --workspace @blue-bee/owner run start` (set `EXPO_PUBLIC_API_BASE_URL` to the host LAN IP on a
  physical device; `app.json extra.apiBaseUrl` / localhost otherwise).
- `… run typecheck | lint | test` · `… run build` (`expo export`, bundles for iOS).
- **Headless integration proof** (the real owner `ApiClient` vs a running API): start the API with
  `SMS_TRANSPORT=console` + relaxed OTP (`OTP_RATE_PER_PHONE/IP=100000`, `OTP_RESEND_COOLDOWN_SECONDS=1`)
  + the seed, then `npm --workspace @blue-bee/owner run integration` — owner login → `/fleet/live` + a live
  WS position (real `POST /locations:batch`) → today → list + approve an approval → exceptions →
  device-token register/unregister → RBAC 403 negatives (**18 checks**).

## On-device (the founder's run — one new parked item)
Headless proves the data path; the **UI rendered on a device + a real push arriving + a tapped push
deep-linking** need a device run (consistent with driver/customer). One new parked item for the owner app.

Node **20** (`.nvmrc`). Foreground app (no background-location task — that's the driver's).
