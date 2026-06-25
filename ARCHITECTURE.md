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
Driver app emits **batched GPS pings** (adaptive duty cycle; faster near a stop, paused off-shift; offline queue) → **stateless ingestion** → **Redis geo** (last-known) + **Timescale** (history) → **Socket.IO** channels → customer (one vehicle, **token-scoped**) and owner + console (all org vehicles). Server recomputes **ETA per ping cluster** (in-house behind the `EtaEstimator` seam — Increment 7; a Google Routes / Mapbox adapter slots in later per §11.2, see the reconciliation note below); **geofence** events → durable `GeofenceEvent` rows + realtime events (the notification engine, Increment 8, consumes those → customer push/SMS/email). The customer channel is scoped by a short-lived signed token to one vehicle for the active stop only. Degrade gracefully: if the live channel drops, fall back to polling last-known + the status timeline.

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

## Notifications (Increment 8 — matrix-driven engine + outbox + transport seam)
The durable `GeofenceEvent` rows from Increment 7 become **real customer alerts** (PRD §8.5/§17.2/§6.4
US-T2 — "truck ~5 min away" + "arrived"). A NEWLY-written geofence crossing is handed (degradation-
wrapped) to `NotificationService.dispatchGeofence`, which runs this pipeline per **(recipient × channel)**:

- **Recipient resolution** (`NotificationRecipientsService`) — the **inverse of the Increment-6 read
  scope**: the owning customers of an order are users holding a CUSTOMER-role grant (`RESIDENTIAL_CUSTOMER`/
  `ACCOUNT_ADMIN`/`ACCOUNT_STAFF`) scoped to the order's **account** (or its **site**). Server-internal →
  **explicit `org_id`** on every query; never a cross-account or cross-org recipient.
- **The §17.2 event→channel matrix** is **config** (`NOTIF_MATRIX_*`), not scattered `if`s — adding a row
  (booking/quote/picked-up/delivered/invoice…) is data. The two geofence alerts default to **Push+SMS+Email**.
- **Preferences + quiet hours** (`NotificationPreference`, pure `notification-policy`/`quiet-hours`): channel
  opt-outs → `SUPPRESSED`; non-urgent events inside a recipient's quiet-hours window are **deferred**
  (`scheduled_for` = window end, DST-correct) or suppressed per `NOTIF_QUIET_HOURS_POLICY`; **urgent** events
  (`NOTIF_URGENT_EVENT_TYPES`, the geofence alerts by default) **bypass** quiet hours.
- **Outbox + idempotency** — one `Notification` row per **(event source × recipient × channel)**, keyed by a
  unique `dedupe_key` + `INSERT … ON CONFLICT DO NOTHING` (the Increment-5 pattern, the second line of
  defense behind the once-per-stop `GeofenceEvent`). Lifecycle `PENDING → SENT | RETRYING | FAILED |
  SUPPRESSED` with `attempts`/`last_error`/`provider_message_id`/`sent_at`/`scheduled_for`.
- **Delivery is OFF the request thread.** Dispatch only **enqueues** (fast, bounded, awaited); a
  `NotificationProcessor` drain (kicked in the background on enqueue, and run by the prod
  `NOTIF_RETRY_SCAN_MS` scan) does the sending — so a transport call can never add latency to
  `POST /locations:batch`. Each row is **atomically claimed** (a conditional `updateMany` that leases
  `scheduled_for` forward) before sending, so concurrent drains across instances **never double-send**.
  Bounded retry with linear backoff; a per-attempt timeout bounds a hung provider; per-channel isolation
  (SMS failing never blocks email/push). `attemptSend` **never throws**.
- **Three real transports behind `NOTIFICATION_TRANSPORTS`** — **SMS** reuses the Increment-2 `SMS_TRANSPORT`
  (Twilio; no second client), **Email** = a real SendGrid v3 call (`SENDGRID_SANDBOX`), **Push** = a real
  Expo Push call (`PUSH_TRANSPORT=expo`). Each has a **real local "console" fallback** (the Increment-2
  pattern — logs + returns a synthetic id, **not a mock**) selected when no provider creds, so the engine
  runs end-to-end without external accounts. MessageBird/SES/native FCM-APNs are the documented swap-ins.
- **Device registration** — `POST/DELETE /v1/device-tokens` (`DeviceToken`): a client registers/deactivates
  its push token, **user-scoped**; the Expo transport reads a recipient's ACTIVE tokens.

**As-built ↔ PRD reconciliations (Increment 8).**
- *Push is partly modeled, by design.* The `DeviceToken` registration endpoint **and** the Expo transport
  are **real + tested**; the only deferred link is a real phone receiving the push (waits on the customer-app
  increment). There is **no mock push client** either way.
- *Provider live-proof needs creds.* The engine + outbox + dedup + preferences + quiet-hours + retry +
  scoping + degradation are fully proven (unit + e2e via the real-but-local console transports). The
  Twilio/SendGrid/Expo provider paths are real code (QC-verified) selected by env; executing them against
  live providers needs test/sandbox creds (a credentialed CI/founder run — see the handoff).
- *Matrix vs §17.2.* §17.2's geofence row is Push+SMS; we additionally deliver **Email** (configurable per
  event) so the customer also gets a durable confirmation.
- *`DeviceToken` vs the legacy `Device`.* §9.1 already had a `Device` record carrying an optional
  `push_token` for session tracking; Increment 8 adds the purpose-built `DeviceToken` (unique token, `active`
  flag, platform) as the real registration surface rather than overload `Device`, which is left untouched.

## Driver app — core duty loop (Increment 9 — the first client surface)
`apps/driver` is a real **React Native + Expo (SDK 51) + TypeScript** app in the npm-workspaces + Turborepo
monorepo (imports `@blue-bee/shared` for every contract). It is the GPS/scan source that powers all the
tracking built in Increments 5–8 (PRD §4.4/§7D/§6.2). The duty loop: **login → start shift → my route today
→ background GPS → walk a stop (§5.4) → push token**. Structured as testable seams:

- **`ApiClient`** — a thin typed wrapper over the proven `/v1` endpoints (auth, `/v1/driver/*`,
  `POST /v1/locations:batch`, `/v1/device-tokens`). Pure `fetch` + an INJECTED token store, so the exact same
  client logic runs in the app (keychain) and in the headless integration proof (memory). A 401 transparently
  refreshes (**single-flight** — concurrent 401s share one `/auth/refresh`) and replays once; a failed refresh
  clears the session; non-2xx → a typed `ApiError` (problem+json; `.isConflict` for a §5.4 409).
- **`SessionProvider`** — OTP login → tokens in `expo-secure-store` (NEVER AsyncStorage, §8.1) → `/me` hydrate;
  logout drops the local session even if the server revoke is offline.
- **Background location** — pure `LocationOutbox`/`toPing`/duty-cycle (unit-tested) behind an
  `expo-task-manager` task wired to `expo-location`. Privacy gate (US-T5/§6.2): emits ONLY while the shift is
  ACTIVE, consent-gated, with a **visible "sharing location" indicator**; stops on shift end/logout (binding
  cleared first so a late OS callback can't reuse an ended shift). A **bounded, idempotent retry buffer** keeps
  pings across a transient network blip (the Inc-5 `ON CONFLICT (vehicle_id, recorded_at)` makes re-sends safe).
- **Push** — a real Expo push token (`expo-notifications`) registered via `POST /v1/device-tokens` on login,
  deactivated on logout — the increment that finally proves Increment 8's real-device push.
- **§5.4 actions** — the available buttons are derived from the SHARED `canTransitionStop` graph (the same the
  server enforces); fail/skip require a reason; a 409 is the server's authority → the app re-syncs.

**The `/v1/driver/*` backend surface (additive, no schema/migration).** Increment 4 shipped the route/stop/
shift endpoints "DRIVER-ready" but authorized them to OWNER/DISPATCHER (ops) only — so a driver couldn't
actually run the loop. Increment 9 adds a thin, strictly **DRIVER-self-scoped** module:
`GET /v1/driver/assignment` (my shift + assigned route + ordered stops, Site geo joined via PostGIS),
`POST /v1/driver/shifts/:id/start|end`, `POST /v1/driver/stops/:id/{depart,arrive,start,complete,fail,skip}`.
It **verifies the caller's driver profile OWNS the shift/stop** (org-scoped base-prisma + `route.driverId`),
then **delegates to the proven `ShiftService`/`RouteStopService`** (the real §5.4 state machine + order
pickup-leg wiring + audit + atomic transitions) — no duplication, the ops endpoints untouched.

**As-built ↔ PRD reconciliations (Increment 9).**
- *Route shape.* The driver action routes use **slash sub-paths** (`/driver/stops/:id/depart`), not the ops
  `:action` colon style — the deeper 3-segment `:id\:action` pattern doesn't match under platform-express's
  path-to-regexp, so the new surface uses the robust, version-proof shape. The proven ops endpoints keep theirs.
- *`asOrgScoped`.* The delegated ops call runs with the driver's principal but org-wide read-scope (userId +
  orgId preserved, so the org boundary + audit actor are unchanged), applied ONLY AFTER the ownership gate
  passes. It is a read-scope widener so the ops service can resolve the org's row, NOT a privilege grant — a
  driver still can't reach another driver's or another org's data (QC-verified, e2e-locked).
- *Deferred (own next increments).* **POD (geo-photo + signature) + scan/tally** wait on the **presigned
  media-upload/storage path still outstanding since Increment 3** (no fake uploads). The **full offline-first
  queue** is deferred — only the basic location-upload retry buffer is in scope. In-app turn-by-turn is a
  native-maps hand-off.
- *On-device proof.* The app is typecheck/lint clean, unit-tested, bundles (`expo export`), and its client is
  proven end-to-end against the live API by a headless integration script. The UI rendered on a device, the OS
  background task firing, and a push physically arriving are the founder's on-device run (no simulator/device in
  the build env) — the same split as Increment 8's credentialed provider proof.

## NFRs that shape the code (PRD §12)
Live location end-to-end < 3s p95; map updates ≥ every 30s within 5 km of a stop. API reads < 300ms / writes < 800ms p95. TLS everywhere + encryption at rest. **PCI handled by tokenizing through Stripe (no raw PAN).** JWT short-lived + RBAC row-scoping. PIPEDA / PHIPA-adjacent care for resident + location data. Retention: pings hot 7d → downsampled 90d; POD 24mo; financial 7y.
