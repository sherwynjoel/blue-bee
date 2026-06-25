# apps/customer — Customer app (React Native + Expo SDK 51)

Residential specialty customers. PRD §4.1, §7A. Built in **Increment 11** on the proven session +
transport seam shared with the driver app (`@blue-bee/api-client`).

## Shipped (Increment 11 — core slice, no pay)

- **Login** — phone OTP → keychain (expo-secure-store) → `/me`, via the shared `useAuthSession`.
- **My orders** — `GET /v1/orders`, row-scoped to the customer.
- **Book** — `POST /v1/orders` (real `serviceId`/`siteId` from `GET /v1/services` + `GET /v1/sites`);
  shows the returned rough estimate range; replay-safe via an `Idempotency-Key`.
- **Order detail** — the §5.1 status timeline rendered from server state; the quote with
  **approve / decline** (`quote:approve` / `quote:decline`, server-authoritative, 409 → re-sync); the
  pre-existing-damage acknowledgement notice + photo; the order's photos via signed `downloadUrl`.
- **Track my truck** — `GET /orders/:id/tracking` → live `WS /live/vehicle` (socket.io-client) on a
  `react-native-maps` map + ETA range + approaching/arrived; **REST is the source of truth** — a dead
  token re-fetches a fresh one, a closed/dropped channel degrades to the REST last-known + timeline.
- **Before/after photos** — `expo-image-picker` → `POST /media/presign` → PUT real bytes →
  `POST /media/confirm`; view via the signed `downloadUrl`. Client validates content-type + size.
- **Push** — `expo-notifications` token → `POST /v1/device-tokens`; a tapped geofence push deep-links
  to that order's tracking (scoped to the customer's own order).

**Stack:** Expo SDK 51 + RN 0.74 + TS · react-native-maps · socket.io-client · expo-image-picker +
expo-file-system · expo-notifications · expo-secure-store · `@blue-bee/api-client` + `@blue-bee/shared`.

## Not in this increment (modelled, not built)

- **Pay (Stripe / Apple Pay / Google Pay)** — Increment 12. Approve takes **no** payment; there is no
  payments backend yet.
- POD / after-photos-at-delivery (a later driver surface) · chat · rate · notification-preferences UI.

## Run

- `npm --workspace @blue-bee/customer run test` · `… run typecheck` · `… run lint`
- `… run build` — `expo export` (Hermes bundle)
- `… run integration` — the headless live-API proof (needs the API running with the seed + MinIO;
  on-device UI render, real camera capture, and a real push arriving are the founder's on-device run).
