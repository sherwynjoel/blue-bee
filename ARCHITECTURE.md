# Architecture — Blue Bee

Condensed from **PRD §9 (data model)** and **§10 (system)**. The PRD is authoritative; this is the map.

## System shape (PRD §10.1)
Clients (RN apps + Next.js web) → **API gateway/BFF (NestJS)** → core services (orders, routes, production, accounts — one **modular monolith**) + **location/tracking gateway** + notification service + billing. Stores: **Postgres + PostGIS** (+ **Timescale** for `GpsPing`), **Redis** (live geo, cache, queues), **S3** (photos/POD). External: Google Maps, Stripe, Twilio, SendGrid, QuickBooks/Xero.

**Why a modular monolith (PRD §10.3):** one operator, hundreds of stops/day — ships faster, cheaper to run, easy to keep transactionally consistent (orders ↔ routes ↔ billing). The **tracking ingestion path** is the one component designed to scale out (stateless + Redis + pub/sub), so it can be peeled off first if needed.

## Lifecycles (PRD §5 — enums MUST match these)
- **Specialty job:** `REQUESTED → SCHEDULED_PICKUP → PICKUP_EN_ROUTE → PICKED_UP → INTAKE_INSPECTED → QUOTED → QUOTE_APPROVED → IN_CLEANING → QC → READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED → INVOICED → CLOSED` (+ branches: quote declined, pre-existing damage flagged, on-hold, rewash, claim opened/resolved).
- **Care-home [Phase 2]:** facility linen (par/COG) stream + resident personal-clothing stream (garment↔resident, return-sort, lost&found).
- **Hotel [Phase 2]:** soil → production → pack-to-par → consolidated manifest → deliver → bill by weight/piece.
- **Shared logistics backbone:** `Route → Stop → Scan → POD`; stop status `PENDING → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED/FAILED/SKIPPED`. **This is what live tracking renders against.**

## Data model (PRD §9 — implement in Prisma)
Entity groups:
- **Identity/accounts:** Organization, User, Role/UserRole, Account, Site, CostCenter, Contact.
- **Catalog/contracts:** Service, LinenSKU, PriceList/PriceListItem, Contract, ParLevel, StandingOrder.
- **Orders/custody:** Order, OrderLine, Item, Tag, Resident, Inspection, Photo, Quote, CustodyEvent.
- **Production/linen:** Cart/Container, SoilIntake, ProductionBatch, PackEvent/LoadSheet, RewashReject, LostFoundItem.
- **Logistics/tracking:** Vehicle, Driver, Shift, Route, RouteStop, GpsPing, GeofenceEvent, ProofOfDelivery, Manifest.
- **Billing/comms/system:** Invoice, Payment, Subscription, CreditNote/Claim, Message, Notification, AuditLog, Device.

Every row carries `id (uuid)`, `org_id`, `created_at`, `updated_at`, `created_by`.

## Real-time tracking path (PRD §6.2)
Driver app emits **batched GPS pings** (adaptive duty cycle; faster near a stop, paused off-shift; offline queue) → **stateless ingestion** → **Redis geo** (last-known) + **Timescale** (history) → **Socket.IO** channels → customer (one vehicle, **token-scoped**) and owner + console (all org vehicles). Server recomputes **ETA per ping cluster** (in-house behind the `EtaEstimator` seam — Increment 7; a Google Routes / Mapbox adapter slots in later per §11.2, see the reconciliation note below); **geofence** events → durable `GeofenceEvent` rows + realtime events (the notification service, a later increment, consumes those). The customer channel is scoped by a short-lived signed token to one vehicle for the active stop only. Degrade gracefully: if the live channel drops, fall back to polling last-known + the status timeline.

## Phase-1 data slice (specialty MVP)
Implement now: Organization/User/Role, Account/Site, Order/OrderLine/Item/Tag/Inspection/Photo/Quote/CustodyEvent, Vehicle/Driver/Shift/Route/RouteStop/GpsPing/GeofenceEvent/ProofOfDelivery, Invoice/Payment/Claim, Message/Notification/AuditLog/Device. Defer linen/resident/production tables to Phase 2 (you may model them but leave them unused).

## Realtime WS contract (Increment 6 — Socket.IO scoped channels)
The live push layer (PRD §6.2/§10.4) sits on top of the Increment-5 REST/store path. OpenAPI
doesn't cover WebSockets, so the contract is documented here.

**Transport:** Socket.IO mounted on the Nest HTTP server, with the **Redis adapter** (cross-instance
fan-out, reusing the stack Redis) behind a thin `RealtimePublisher` abstraction (Ably/Pusher swap-in
later). The WS is an **optimization** — the REST last-known (`GET /v1/fleet/live`,
`GET /v1/orders/:id/tracking`) + the stop status timeline remain the **source of truth**; a dropped
socket degrades to polling (§12.3).

**"Paths" are Socket.IO namespaces** (Socket.IO has no REST path params, so the `:token` in
`WS /live/vehicle/:token` is passed in the handshake `auth.token`, not the URL):

| Namespace | Who | Handshake `auth.token` | Bound to (server-side) |
|---|---|---|---|
| `/live/vehicle` | customer (owns the order) | the **signed channel token** from `GET /v1/orders/:id/tracking` | exactly ONE vehicle room + its stop room |
| `/live/fleet` | OWNER / DISPATCHER / CSR | the **access JWT** | the caller-org fleet room (all org vehicles) |

**Subscription is server-bound** — there is **no client→server subscribe event**, so a client can
never request another room (authorize-by-construction, on top of authorize-on-connect).

**Server→client events:**
- `position` → `LivePositionEvent { vehicleId, lat, lng, speed, heading, recordedAt }` — emitted ONLY
  when last-known genuinely advances (Lua-CAS monotonicity: no regression on out-of-order pings, no
  duplicate storms). To the vehicle room (shared truck location) + the org fleet room.
- `eta` → `LiveEtaEvent { vehicleId, stopId, orderId, eta, low, high, etaSeconds, computedAt }`
  (Increment 7) — a refreshed server-side ETA RANGE for the customer's active stop, emitted on each
  genuine advance after EWMA smoothing. To the customer's **stop room** (stop-specific — a co-routed
  customer on a different stop never sees this stop's ETA) + the org fleet room.
- `geofence` → `LiveGeofenceEvent { vehicleId, stopId, orderId, type, occurredAt }` (Increment 7) —
  a geofence crossing (`APPROACHING`/`ARRIVED`), fired EXACTLY once per stop per type (idempotent),
  emitted only when the durable `GeofenceEvent` row was actually written. Same scoping as `eta`.
  Advisory only — does NOT transition the §5.4 stop (the driver stays authoritative).
- `channel:closed` → `ChannelClosedEvent { reason, vehicleId, stopId? }` — sent just before a
  server-side disconnect. `reason ∈ { stop_completed, stop_failed, stop_skipped, shift_ended, token_expired }`.

**Channel token (customer):** dedicated-secret HS256 JWT (`CHANNEL_TOKEN_SECRET`, never the auth JWT),
`kind: 'vehicle-tracking'`, claims `{ org_id, vehicle_id, order_id, stop_id, sub, exp }`. Minted by
`GET /v1/orders/:id/tracking` only when there's an active stop with an assigned vehicle. At the WS
handshake the server verifies signature + expiry + kind **and re-checks live stop state** (route still
PUBLISHED/IN_PROGRESS, stop non-terminal, route still points at the bound vehicle); any failure rejects
the connection (`connect_error`). So a token for a completed/failed/skipped stop or a reassigned route
is useless even before `exp`.

**Lifecycle teardown (no leak after delivery):** a socket is force-disconnected on (1) token `exp`
(per-socket timer), (2) stop terminal transition (`closeStopChannel` from the §5.4 state machine), and
(3) shift end (`closeVehicleChannel`). Reconnect after any of these fails the live re-check.

**Connection errors** (`connect_error.message`): `missing_channel_token` · `stop_not_active` ·
`missing_access_token` · `token_revoked` · `forbidden_role` · plus JWT verify throws (bad signature /
expired / wrong kind). The default `/` namespace is rejected (no unauthenticated surface).

## Server-side ETA + geofence (Increment 7 — predictive tracking layer)
The push layer becomes **predictive** (PRD §6.2/§6.4/§10.4). On each **genuine last-known advance**
(the Lua-CAS monotonicity gate = the §10.4 "ping cluster" sampling), the ingestion service awaits
`TrackingPredictionService.onLastKnownAdvance(orgId, vehicleId, headPosition)`:

- **ETA (`EtaService` → `EtaEstimator` seam).** Resolves the vehicle's current active stop (a
  PUBLISHED/IN_PROGRESS route + a stop that is `EN_ROUTE`/`ARRIVED` — never pending/terminal), reads
  the stop's `Site` geo destination, and computes a smoothed ETA **range**: remaining distance via the
  **same PostGIS `ST_Distance` geography** the sequencer uses × a configurable road-circuity factor ÷ a
  speed **derived from recent pings** (distance/time across the last N advances, floored/ceiled, with a
  configured urban-average fallback when stationary/first-ping/noise). EWMA-smoothed against the prior
  estimate (aged by elapsed time, so it shrinks without jitter), capped, surfaced as `low`/`high`.
  Persisted on `RouteStop.eta`/`eta_low`/`eta_high`/`eta_computed_at` (so REST reads + the console see
  it) and emitted as the `eta` WS event.
- **Geofence (`GeofenceService`).** Reuses the ETA's distance: `APPROACHING` fires within
  `GEOFENCE_APPROACHING_RADIUS_M` **or** ETA ≤ `GEOFENCE_APPROACHING_ETA_SEC` (the §6.4 "800 m / 5 min"
  rule, whichever first); `ARRIVED` within the tighter `GEOFENCE_ARRIVED_RADIUS_M`. Each type fires
  **exactly once per stop** (`@@unique([route_stop_id, type])` + `INSERT … ON CONFLICT DO NOTHING`), so
  jitter/re-entry/replay/concurrent batches never re-fire. The durable `GeofenceEvent` row + the
  `geofence` WS event are written; `ARRIVED` is **advisory** and does NOT transition the §5.4 stop.
- **Degradation (§12.3).** The whole predictive path is wrapped — any estimator/geofence failure is
  logged and swallowed so it can **never** fail `POST /locations:batch`. REST last-known + the status
  timeline remain the source of truth.
- **Config.** Every tunable (`ETA_*`, `GEOFENCE_*`) lives in `tracking.config.ts`/`.env` — no literals.

**REST first-paint:** `GET /v1/orders/:id/tracking` returns `stop.{eta,etaLow,etaHigh,etaComputedAt}`
alongside `{lastKnown, channelToken}`; `GET /v1/fleet/live` returns each vehicle's `nextStopEta`.

**As-built ↔ PRD reconciliation (ETA provider).** The PRD writes ETA "via Routes API"
(§6.2). Increment 7 computes ETA **in-house behind the `EtaEstimator` seam — no external map/routing
API, no maps key**. This is faithful to the PRD's own **§11.2/§10.2** provider-abstraction intent
(maps/routing is explicitly a swappable seam — Google Routes / Mapbox / Onfleet / Routific), mirroring
how Increment 4's sequencer is in-house behind the `RouteOptimizer` seam. A managed-provider adapter
can replace `PostgisEtaEstimator` later without touching any caller. **No notification delivery** this
increment (also a swappable seam, §10.2) — the durable `GeofenceEvent` row + the realtime event ARE
the triggers the notifications increment will consume; there is intentionally **no stub sender**.

## NFRs that shape the code (PRD §12)
Live location end-to-end < 3s p95; map updates ≥ every 30s within 5 km of a stop. API reads < 300ms / writes < 800ms p95. TLS everywhere + encryption at rest. **PCI handled by tokenizing through Stripe (no raw PAN).** JWT short-lived + RBAC row-scoping. PIPEDA / PHIPA-adjacent care for resident + location data. Retention: pings hot 7d → downsampled 90d; POD 24mo; financial 7y.
