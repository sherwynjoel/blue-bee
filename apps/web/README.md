# apps/web — Operator Console (Next.js)

The back-of-house **operator console** (role-gated) over the proven `/v1` API. PRD §4.2, §7B.
Built in **Increment 13** on `packages/api-client` (the shared transport) + `@blue-bee/shared`.

## Shipped (Increment 13 — the operator loop)

- **Shell + auth + RBAC** — phone-OTP login (shared `useAuthSession`), a role-gated app shell;
  ops roles only (a customer-only token gets a clear "no access"). UI gating mirrors §17.3 and is
  backed by server enforcement (every endpoint `@Roles`).
- **Orders queue + detail** — `GET /orders` (row-scoped), filterable; order detail renders the
  **§5.1 timeline from server state** + lifecycle actions (schedule-pickup / receive / hold / resume).
- **Intake + inspection** — record condition + measurements; flag pre-existing damage with a real
  photo via the **`/media` presign → PUT (real bytes) → confirm** flow (web file input).
- **Quote** — generate (server-side rate-card math), adjust (audited), send; ops approve/decline.
- **Routing / dispatch** — vehicles/drivers/shifts; build a route, add stops, assign, **optimize**
  (the PostGIS sequencer), **publish**, **manifest**; walk a stop's **§5.4** state (illegal → server 409).
- **Live fleet board** — `GET /fleet/live` + `WS /live/fleet` (`socket.io-client`, access JWT in the
  handshake) on a **react-leaflet** map (behind a seam); **REST is the source of truth** — the board
  degrades to the snapshot + polling if the socket drops (never a blank screen).
- **Finance (OWNER/FINANCE)** — view payments + invoices; **refund** (≤ captured, surfaced +
  server-enforced); **generate invoice**; see **disputes**. All gated in UI **and** server-side.

**Stack:** Next.js 14 (App Router) + TS + Tailwind · `packages/api-client` (+ a web `TokenStore`) ·
`socket.io-client` · react-leaflet (OSM, no key) · `@blue-bee/shared`.

## Token strategy

Access token **in memory** + refresh token in **localStorage** (the api-client `TokenStore`,
unchanged transport). The documented XSS trade-off + the recommended httpOnly-cookie hardening (and
why it's a follow-up given the body-refresh contract + the WS handshake needing the access token in
JS) are in `lib/token-store.ts` and the handoff.

## Run / verify

- `npm --workspace @blue-bee/web run dev` (port 3001; set `NEXT_PUBLIC_API_BASE_URL`)
- `… run typecheck` · `… run lint` · `… run test` · `… run build` (`next build`)
- `… run integration` — the headless live-API operator-loop proof (needs the API running with the
  seed + MinIO; `STRIPE_WEBHOOK_SECRET` matching the API). **No on-device item — fully headless.**

## Not in this increment

The owner app (RN/Expo — next) · productionize-on-Railway (the deploy increment) · the marketing
site · on-delivery payment capture · Phase-2 verticals.
