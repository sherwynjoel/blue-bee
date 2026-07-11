# Step 3 — Ratings / CSAT, on a real delivery spine (Inc-30 → Inc-31 → Inc-32)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee`
**From:** planning/QC chat · **For:** Claude Code (executes one increment at a time; this chat audits each before the next).
**Backlog item:** Tier-2 Step 3 — Ratings / post-delivery CSAT (PRD A6.3 [MVP]).
**Rule (unchanged):** every increment is a real vertical slice — migration + endpoint(s) + surface + tests, all proven to run. `org_id` on every row + server-side row-scoping. TS strict. Lifecycle/enums per PRD §5/§9 — **no invented statuses** (all the statuses below already exist in the enum; we are wiring the transitions that were never written). No stubs, no fabricated data. Log each increment to `CHANGELOG.md` + a dated `handoffs/` file; material milestone rolls up to `Projects/CHANGELOG.md` under `[BLUE BEE]`.

---

## Why this is three increments, not one

Ratings must attach to a genuinely **delivered** order. The audit of the shipped code found that **no service ever advances an order past `QUOTE_APPROVED`** — the back half of the §5.1 spine (`IN_CLEANING → QC → READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED`) has legal transitions defined in `packages/shared/src/lifecycle.ts:21-50` and validated by `OrderStateMachine`, but **nothing calls `apply()` toward any of them**. Verified: the only order-status writes in `apps/api/src` are pickup/intake/quote/hold + a dead `DELIVERED → INVOICED` in `payments/payment.service.ts:424-425` (it *reads* `DELIVERED`, which no row ever has). `owner.service.ts:31` and `analytics.service.ts` likewise only *read* `DELIVERED`.

So "rate a delivered order" has no real trigger until delivery is wired. Founder decision (2026-07-10): **build the full spine, split three ways.**

- **Inc-30 — Production advance** (`QUOTE_APPROVED → IN_CLEANING → QC → READY`). Owner/console-driven plant transitions.
- **Inc-31 — Delivery legs** (`READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED`). Driver/route-driven, POD-gated, writes the `DELIVERED` `CustodyEvent`, and makes the existing `DELIVERED → INVOICED` payment path live.
- **Inc-32 — Ratings + rate-request push.** Gates on the now-real `DELIVERED`.

Each ships and is audited before the next. This also closes a real MVP gap independent of ratings: "deliver" in *book → track → custody → deliver → bill* was never actually wired.

---

## Ground truth the increments build on (verified file:line)

- **Order status writes** all go through `OrderStateMachine.apply(tx, order, to, opts)` — `apps/api/src/orders/state-machine.service.ts:36-79`: atomic conditional `updateMany({ where:{ id, orgId, status: from } })` (loser → 409), always writes an `AuditLog`. Reuse it; never write `order.status` directly.
- **Legal graph:** `packages/shared/src/lifecycle.ts:21-50` (`SPECIALTY_ORDER_TRANSITIONS`) already permits every hop below — `READY→SCHEDULED_DELIVERY`, `SCHEDULED_DELIVERY→DELIVERY_EN_ROUTE`, `DELIVERY_EN_ROUTE→DELIVERED`, `DELIVERED→INVOICED|CLAIM_OPENED`. No lifecycle edits needed.
- **Pickup legs to mirror:** `apps/api/src/logistics/route-stop.service.ts` — `run()` at 79-108 (the single stop-verb applier), `pickupDepartLeg` 112-119, `pickupCompleteLeg` 122-133 (advances order + writes a `CustodyEvent(stage=PICKED_UP)` per item, ordered by `ITEM_ORDER_BY`).
- **Route publish scheduling:** `apps/api/src/logistics/route.service.ts:206-223` advances pickups `REQUESTED → SCHEDULED_PICKUP` when a route is published (deduped per order). The delivery analog (`READY → SCHEDULED_DELIVERY`) slots into the *same* loop.
- **POD gate already exists:** `apps/api/src/driver/driver.service.ts:220-231` blocks completing a DELIVERY-kind stop without a captured `ProofOfDelivery`. So Inc-31's `deliveryCompleteLeg` only runs after real POD.
- **Order read include:** `FULL_INCLUDE` — `apps/api/src/orders/orders.service.ts:50-76` — already includes `routeStops { kind, status, ... }` and `items` ordered by `ITEM_ORDER_BY` (`apps/api/src/orders/item-order.ts:20`). The customer app already receives everything the rating gate needs.
- **Staff order-action endpoints to mirror:** `OrdersController` — `schedule-pickup` (`orders.controller.ts:79-85`) and `received-at-plant` (87-93). Class is `@Controller('orders')` + `@UseInterceptors(IdempotencyInterceptor)` (43-46). Colon-verb routes escaped as `\\:` (see `:quote\\:approve` at 124).
- **Auth/convention:** URI versioning `/v1` (`main.ts:64-65`); `@CurrentUser() p: RequestPrincipal` + `@Roles(...)` (`auth/rbac/decorators.ts`); `ZodBody` pipe; `ProblemJsonFilter`; ownership via `OrderAccessService.requireOrderForWrite` (`orders/order-access.service.ts:35-49`) over the scoped Prisma client.
- **No `Order.customerId`.** A customer is a `User` with a `RESIDENTIAL_CUSTOMER` grant; the order link is `User → UserRole(scope=ACCOUNT, scopeId=accountId) → Account ← Order.accountId`. To resolve "who may rate," reuse the join in `NotificationRecipientsService.resolveOrderRecipients()` (`apps/api/src/notifications/notification-recipients.service.ts:29-42`). **Do not** add an `Order.customerId` column.
- **Analytics reserved slot:** `apps/api/src/analytics/analytics.service.ts:427` — `csat: this.deferred<number>('...no CSAT capture exists in Phase 1.')`. Inc-32 turns this one line into a real `this.metric<number>(...)`.

---

## INC-30 — Production advance (`QUOTE_APPROVED → IN_CLEANING → QC → READY`)

**Intent:** give the plant/owner side real controls to move an approved order through cleaning and QC to READY, so it can be scheduled for delivery. Console-driven (there is no driver action for plant work).

**Backend** (`apps/api/src/orders/`):
- Add a `ProductionService` (or extend `IntakeService` — match how the module groups pickup/receive). Three transitions, each through `OrderStateMachine.apply` inside a `$transaction`, each audited (the state machine already writes the `AuditLog`):
  - `startCleaning`: `QUOTE_APPROVED → IN_CLEANING`.
  - `sendToQc`: `IN_CLEANING → QC`.
  - `markReady`: `QC → READY`.
- Also wire the **rewash branch** that the lifecycle already allows (`IN_CLEANING⇄REWASH`, `QC→REWASH`): a `rewash` action `QC → REWASH` and `IN_CLEANING → REWASH`, and `REWASH → IN_CLEANING` on restart. Small, and it's in `SPECIALTY_ORDER_TRANSITIONS` (lifecycle.ts:36-38) — wire it so QC failures are real, not a dead enum. If you want to defer rewash to keep the increment tight, flag it — but the happy path (`IN_CLEANING→QC→READY`) is mandatory.
- **Endpoints** on `OrdersController`, mirroring `schedule-pickup`, `@Roles(RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP)`, idempotency-keyed (interceptor is class-level), `@HttpCode(200)`:
  - `POST /v1/orders/:id/start-cleaning`
  - `POST /v1/orders/:id/qc` (body: pass/fail → READY or REWASH)
  - `POST /v1/orders/:id/ready`
  - (`POST /v1/orders/:id/rewash` if not folded into `qc`)
- DTOs + Zod schemas in `packages/shared/src/orders.ts` (optional `note`, and for `qc` a `result: 'pass'|'fail'` + optional `reason`). Row-scope via `requireOrderForWrite`; wrong-org → 404, cross-account staff → 403 per existing gate.
- **Honesty:** no auto-advance, no timers — a human triggers each step from the console. Each transition is a real audited state change.

**Console (`apps/web`):**
- On the staff single-order view (`apps/web/app/(console)/orders/[id]/page.tsx`), add a **Production** action group that shows the legal next action for the order's current status (Start cleaning / Send to QC / Mark ready / Rewash), calling the new endpoints. Buttons reflect `SPECIALTY_ORDER_TRANSITIONS` so an illegal action is never offered; a 409 (concurrent change) surfaces as "order moved on, refresh."
- No customer-app change in Inc-30 (production is internal). The customer timeline (`StatusTimeline`) already renders these milestones and will now light up as the order moves.

**Verify (proof):** create an order, drive it to `QUOTE_APPROVED`, then via the console (or e2e) `start-cleaning → qc(pass) → ready`; assert each `Order.status` in the DB **and** a matching `AuditLog` row; assert `qc(fail) → REWASH → start-cleaning → IN_CLEANING`; assert an illegal jump (e.g. `ready` from `IN_CLEANING`) → 409/validation; cross-org → 404, cross-account staff → 403. `apps/api` `tsc` + new `production.e2e-spec.ts` green (mirror `apps/api/test/pod.e2e-spec.ts` structure: real app/Postgres, minted JWTs, assert body + DB row). Web `tsc` + a component test for the action group green.

**Deploy:** `railway up` (api + web). No app rebuild (console only).

---

## INC-31 — Delivery legs (`READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED`)

**Intent:** wire the delivery half exactly like the pickup half so completing a real, POD-gated delivery stop advances the order to `DELIVERED`, writes the `DELIVERED` custody chain, and makes the existing `DELIVERED → INVOICED` payment path live.

**Backend:**
1. **Scheduling** (`apps/api/src/logistics/route.service.ts`, publish loop 213-221): in the same per-order dedup loop, add the delivery case — for a `RouteStopKind.DELIVERY`/`BOTH` stop whose order is `READY`, `apply(READY → SCHEDULED_DELIVERY)` (reason `'scheduled onto a published route'`, `extraAudit: { routeId, stopId }`). Keep the existing pickup case. A `BOTH` stop on a READY order schedules delivery; on a REQUESTED order schedules pickup — handle both without double-applying (the `scheduled`-set dedup already guards per order; use a per-leg key so a `BOTH` order isn't skipped for the second leg).
2. **Depart leg** (`route-stop.service.ts`): add `deliveryDepartLeg(tx, stop, actorId)` mirroring `pickupDepartLeg` (112-119) — for a DELIVERY/BOTH stop with an order in `SCHEDULED_DELIVERY`, `apply(SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE)`. Wire it in `run()` at line 92 alongside the pickup depart (`if (opts.leg === 'depart')`), keyed off `stop.kind` so pickup stops keep hitting `pickupDepartLeg` and delivery stops hit `deliveryDepartLeg`.
3. **Complete leg** (`route-stop.service.ts`): add `deliveryCompleteLeg(tx, stop, actorId)` mirroring `pickupCompleteLeg` (122-133) — for a DELIVERY/BOTH stop with an order in `DELIVERY_EN_ROUTE`, `apply(DELIVERY_EN_ROUTE → DELIVERED)`, then write a `CustodyEvent(stage=CustodyStage.DELIVERED)` **per item, ordered by `ITEM_ORDER_BY`** (append-only, `deviceId: 'route-stop-delivery'`), and set each `Item.status = DELIVERED` (the `ItemStatus` enum already has `DELIVERED`). Wire in `run()` at line 93 alongside `pickupCompleteLeg`, keyed on `stop.kind`.
   - The **POD gate is already enforced** on the driver path (`driver.service.ts:226-229`, `DELIVERY_KINDS = {DELIVERY, BOTH}` at :42) — a delivery stop cannot reach `complete` without a captured `ProofOfDelivery`. **Check before relying on it:** `run()` (`route-stop.service.ts:79`) is the shared applier for *both* `/v1/driver/stops/:id/complete` **and** the dispatch/owner `/v1/route-stops/:id\\:complete` path. The POD check sits in `driver.service.ts`, so confirm the owner/dispatch complete route can't bypass POD on a DELIVERY stop — if it can, move/duplicate the POD assertion into the shared `deliveryCompleteLeg` (or `run()`) so `DELIVERED` is never reachable without proof, regardless of caller. Add an assertion test for both entry points.
4. **Payment path goes live automatically:** once an order can reach `DELIVERED`, `payment.service.ts:424-425` (`DELIVERED → INVOICED` on paid) starts firing for real. Add/greenlight an e2e that pays a delivered order and asserts `INVOICED`.
5. **Realtime teardown** already handled — `run()` closes the customer tracking channel on any terminal stop (`route-stop.service.ts:102-106`). Delivery stops use the same terminal path; no change.

**Driver/customer apps:** the driver already drives stop verbs (`depart/arrive/start/complete`) and captures POD; delivery stops use the same verbs, so **no new driver screen** — just confirm a DELIVERY stop flows through the existing UI to `complete`. Customer timeline (`StatusTimeline`, `TIMELINE_SPINE` includes `DELIVERED` at idx 12) now lights up through delivery with no client change.

**Verify (proof):** extend the POD e2e (`apps/api/test/pod.e2e-spec.ts`) — build an order to `READY` (via Inc-30 or a fixture), put it on a published route with a DELIVERY stop → assert `SCHEDULED_DELIVERY`; `depart` → assert `DELIVERY_EN_ROUTE`; attempt `complete` without POD → 400 (`POD_REQUIRED`); capture POD → `complete` → assert `RouteStop.status = COMPLETED` **and** `Order.status = DELIVERED` **and** a `CustodyEvent(stage=DELIVERED)` exists for every item in `ITEM_ORDER_BY` order **and** every `Item.status = DELIVERED`; then pay → assert `INVOICED`. Cross-driver 403 already covered. `apps/api` `tsc` green.

**Deploy:** `railway up` (api). No app rebuild required for the wiring, but this is the increment after which the timeline/analytics become real — worth a driver/customer EAS rebuild if batching stops here; otherwise batch with Inc-32.

---

## INC-32 — Ratings / CSAT + rate-request push

**Intent:** after `DELIVERED`, the customer can rate the order (1–5 + optional comment); the average surfaces in console analytics + the account scorecard; a push invites them to rate.

### Design decisions (defaults — flag if you want them changed)
- **Order-level rating.** `score` Int 1–5 required; `comment` String? optional (≤1000 chars, trimmed). **No per-item breakdown** — we don't collect per-item quality signals, so we won't render a fake one (honesty firewall; consistent with the `deferred()` culture). Per-item quality can extend `Item`/`Claim` later if ever needed.
- **One rating per order:** `@@unique([orgId, orderId])`. Record `submittedByUserId` for audit. A second create on an already-rated order → 409 (`RATING_ALREADY_EXISTS`) unless it's the same submitter using `PATCH` to revise.
- **Who may rate:** the order's customer-side principals only — `RESIDENTIAL_CUSTOMER` or `ACCOUNT_ADMIN` resolved via the `resolveOrderRecipients` join on `Order.accountId`/`siteId`. Owner/CSR/plant staff **cannot** rate. Cross-account → 403; cross-org/nonexistent → 404 (mirror `order-access` semantics, don't leak existence).
- **Eligibility window:** rateable once `Order.status` has reached `DELIVERED` (i.e. `DELIVERED`, `INVOICED`, `CLAIM_*`, `CLOSED`) — not before. Compute with a small pure helper; do not hard-require `status === 'DELIVERED'` exactly (an invoiced order is still rateable).
- **Editable:** the original submitter may `PATCH` their rating within 30 days of creation; immutable after. (Flag if you'd rather make it create-once-immutable.)

### Backend
- **Schema** (`apps/api/prisma/schema.prisma`): new `Rating` model with the house columns (`id, orgId, createdAt, updatedAt, createdBy`) + `orderId`, `score Int`, `comment String?`, `submittedByUserId`. `@@unique([orgId, orderId])`, `@@index([orgId])`, relation to `Order` (`ratings`/`rating`). New migration under `apps/api/prisma/migrations/` (runs at boot via `prisma migrate deploy`). It's a new table, so no backfill.
- **Shared** (`packages/shared/`): new `src/ratings.ts` mirroring `orders.ts` shape — `createRatingSchema` (`score: z.number().int().min(1).max(5)`, `comment: z.string().max(1000).optional()`), `patchRatingSchema`, `z.infer` DTOs, a `RatingView` response interface, and a `RATING_ERRORS` const (mirror `ORDER_ERRORS`, `orders.ts:205-220`: `RATING_ALREADY_EXISTS`, `ORDER_NOT_RATEABLE`, `NOT_ORDER_CUSTOMER`). Add `export * from './ratings'` to `src/index.ts`. Rebuild `packages/shared` before consumers see it.
- **Module** `apps/api/src/ratings/` — `RatingsService` + `RatingsController` (`@Controller('orders')` or a dedicated `ratings` controller; keep the route under the order for scoping):
  - `POST /v1/orders/:id/rating` — `@Roles(RESIDENTIAL_CUSTOMER, ACCOUNT_ADMIN)`, idempotency-keyed, `@HttpCode(201)`. Validates eligibility (delivered-or-later) + customer-ownership (resolve-recipients join) + uniqueness; creates the row; returns `RatingView`.
  - `PATCH /v1/orders/:id/rating` — same roles; only the original `submittedByUserId` within 30 days; else 403/409.
  - `GET /v1/orders/:id/rating` — returns the rating or 404; row-scoped (customer sees their order's rating; owner/CSR may read for the console).
- **Row-scope** everything through the scoped Prisma client / `requireOrderForWrite`-style gate; `org_id` on the row; never trust client-supplied identity.

### Rate-request push (new plumbing)
- **New event type** `RATE_REQUEST` (or `DELIVERY_COMPLETE`) added to `NOTIFICATION_EVENTS` in `packages/shared` + a template in `apps/api/src/notifications/notification-templates.ts` (`renderTemplate`, currently 58-116 handles GEOFENCE_*/PAYMENT_*). Copy: honest, plain — "Your order was delivered. How did we do?" deep-linking to the Rate screen.
- **Call site:** enqueue the notification from the **`DELIVERED` transition** (cleanest: in Inc-31's `deliveryCompleteLeg`, after the status apply, publish a `RATE_REQUEST` for the order's customer recipients via the existing notifications pipeline). Respect existing `NotificationPreference` channel settings (quiet-hours proper is Step 5, but honor the prefs that already exist). Do not fabricate a channel the customer hasn't enabled.
  - *Note:* this couples the push to Inc-31's call site — fine since Inc-31 lands first. Add the enqueue in Inc-32 (or stub the call site in Inc-31 with a real no-op comment and fill it in Inc-32 — prefer adding it in Inc-32 so Inc-31 has no dead code).

### Customer app (`apps/customer`)
- `src/api/customer-client.ts`: add `submitRating(orderId, dto, idempotencyKey)`, `updateRating(orderId, dto)`, `getRating(orderId)` — follow the `book(dto, idempotencyKey)` / `createSite` pattern (forward `{ idempotencyKey }`).
- **Eligibility helper** in `src/orders/` (mirror `quote.ts`'s `hasActiveStop`): `isRateable(order)` (delivered-or-later) + `alreadyRated(order)` (needs the rating in the order payload — either add `rating` to `FULL_INCLUDE` so `getOrder` returns it, or fetch via `getRating`; prefer adding `rating` to `FULL_INCLUDE` for one round-trip).
- **`RateScreen`** (new): 1–5 star selector + optional comment + submit; success returns to OrderDetail showing the submitted rating (read-only, with Edit if within window). Register in `navigation.ts` `RootStackParamList` **and** `App.tsx` `RootNavParamList` + `<RootStack.Screen name="Rate" .../>` (the files warn both must agree).
- **Entry points:** a "Rate this order" card on `OrderDetailScreen` just after `<StatusTimeline>` (≈ line 252), gated by `isRateable && !alreadyRated`; and a "Rate" affordance on the delivered order's `OrderCard` in `OrdersScreen`. After rating, show the score read-only.

### Console (`apps/web`)
- **Analytics:** replace `analytics.service.ts:427` `csat: this.deferred<number>(...)` with a real `this.metric<number>(...)` computing average `score` over the window (helper returns `{ value, rowCount }`, wrapped by `metric()` so failure degrades to `status:'error'`, never 500). The web `Stat` component already renders real/`unavailable`/`error` states — a real value now shows instead of the Phase-2 badge.
- **Account scorecard:** add an average-rating tile to `accountScorecard()` (`analytics.service.ts:602-647`) surfaced in `AccountDetail.tsx` `ScorecardCard` (159-195) via the existing `Stat` pattern (198-213).

### Verify (proof)
- API `ratings.e2e-spec.ts` (mirror `pod.e2e-spec.ts`): deliver an order (Inc-31 path) → customer `POST rating` succeeds, row in DB with `score/comment/submittedByUserId/orgId`; rating **before** DELIVERED → `ORDER_NOT_RATEABLE`; second create → 409 (`RATING_ALREADY_EXISTS`); `PATCH` by original submitter → updates; `PATCH` by another user → 403; a different account's customer → 403/404; owner/CSR create → 403; idempotent re-POST replays (interceptor). Analytics: after N ratings, `commercial().csat` and `accountScorecard` average = expected (assert value + rowCount).
- Customer screen test (mirror `OrderDetailScreen.test.tsx`): `getOrder` returns a DELIVERED order with no rating → "Rate this order" CTA renders; submit → `submitRating` called with the right body; returns → shows read-only score. A non-delivered order → no CTA.
- Notifications: assert a `RATE_REQUEST` notification is enqueued on `DELIVERED` for the order's customer recipients, and suppressed where prefs disable the channel.
- `apps/api` `tsc` + `apps/customer` `tsc` + `apps/web` `tsc` green; `packages/shared` rebuilt.

**Deploy:** `railway up` (api + web) + **EAS rebuild (customer)** so `RateScreen` + CTAs reach phones — batch this with any pending app changes (Inc-28's customer screens are also awaiting an EAS build per the current handoff).

---

## Cross-cutting / honesty firewall
- No fabricated ratings, no seeded fake CSAT numbers, no per-item quality UI we don't collect. Analytics shows a real average or the honest `unavailable`/`error` state — never a made-up score.
- Every new row carries `org_id`; every read/write is row-scoped server-side; cross-account → 403, cross-org → 404 (no existence leak).
- Custody events stay append-only (the `DELIVERED` events in Inc-31 are inserts only).
- Scope is Track-A specialty `Order` rows only (Track-B resident garments have no `Order` — out of scope, by design).

## Sequencing & dependencies
Inc-30 → Inc-31 → Inc-32, each audited by this chat before the next. Inc-31 depends on Inc-30 (an order must reach READY to schedule delivery). Inc-32 depends on Inc-31 (needs real DELIVERED + the push call site). Batch the single customer EAS build at the end (with Inc-28's pending screens). Log each increment to `CHANGELOG.md` + a dated `handoffs/` file; roll the "delivery + ratings live" milestone up to `Projects/CHANGELOG.md` `[BLUE BEE]`.
