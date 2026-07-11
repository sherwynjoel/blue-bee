# Inc-31 kickoff — Delivery legs (`READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED`)

**Working folder:** `/Volumes/Gowtham/Blue Bee` · **For:** Claude Code (execute now) · **Audited by:** planning/QC chat after.
**Parent brief:** `handoffs/2026-07-10-step3-ratings-csat-brief.md` (Inc-31 section). This is the scoped, paste-ready cut. Inc-30 (production advance) is merged + audit-cleared, so orders can now reach `READY`.
**Rule (unchanged):** real vertical slice, no stubs. `org_id` on every row, server-side row-scope, TS strict. **No lifecycle edits** — every edge below already exists in `SPECIALTY_ORDER_TRANSITIONS` (`packages/shared/src/lifecycle.ts:40-42`). Mirror the pickup wiring exactly. Log to `CHANGELOG.md` + a dated `handoffs/` file. **Do NOT `railway up`** — we batch-deploy Inc-28/29/30/31 (+Inc-32) at the end.

## Goal
Wire the delivery half of the §5.1 spine so a real, POD-gated delivery-stop completion advances the order to `DELIVERED`, writes the `DELIVERED` custody chain, and makes the already-present `DELIVERED → INVOICED` payment path live. This mirrors the pickup legs one-for-one.

## Build

**1. Scheduling — `apps/api/src/logistics/route.service.ts` (publish loop, 206-223).**
In the same per-order dedup loop that advances pickups `REQUESTED → SCHEDULED_PICKUP` (216-220), add the delivery case: for a stop whose `kind ∈ {DELIVERY, BOTH}` and whose order is `READY`, `apply(order, OrderStatus.SCHEDULED_DELIVERY, { actorId, reason: 'scheduled onto a published route', extraAudit: { routeId, stopId } })`. Keep the pickup case. **`BOTH`-stop caveat:** the current `scheduled` set dedups per *order id*, which would skip the second leg of a `BOTH` order. Key the dedup per *(orderId, leg)* (or handle pickup and delivery independently) so a `BOTH` stop can schedule both legs where each order-state applies. A `BOTH` stop on a `REQUESTED` order schedules pickup; on a `READY` order schedules delivery — never both in one publish for the same order.

**2. Depart leg — `apps/api/src/logistics/route-stop.service.ts`.**
Add `deliveryDepartLeg(tx, stop, actorId)` mirroring `pickupDepartLeg` (112-119): for a `DELIVERY/BOTH` stop with `stop.orderId` and order in `SCHEDULED_DELIVERY`, `apply(SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE)`. In `run()` (79-108) at the `opts.leg === 'depart'` branch (92), dispatch on `stop.kind`: pickup kinds → `pickupDepartLeg`, delivery kinds → `deliveryDepartLeg`. (`DELIVERY_KINDS = {DELIVERY, BOTH}` already exists at `apps/api/src/driver/driver.service.ts:42` — reuse/promote a shared constant rather than re-deriving.)

**3. Complete leg — `route-stop.service.ts`.**
Add `deliveryCompleteLeg(tx, stop, actorId)` mirroring `pickupCompleteLeg` (122-133): for a `DELIVERY/BOTH` stop with order in `DELIVERY_EN_ROUTE`:
   - `apply(DELIVERY_EN_ROUTE → DELIVERED, { actorId, reason: 'delivered at stop', extraAudit: { stopId } })`.
   - For each item of the order, **ordered by `ITEM_ORDER_BY`** (`apps/api/src/orders/item-order.ts:20`), write an append-only `CustodyEvent{ orgId, itemId, stage: CustodyStage.DELIVERED, actorId, deviceId: 'route-stop-delivery', createdBy: actorId }` and set `Item.status = ItemStatus.DELIVERED`.
   - **Set `Item.status = DELIVERED` unconditionally** — per the Inc-30 audit, there is no Item state machine and items sit at `INSPECTED` (or `RECEIVED` if never inspected) at delivery time; do **not** guard on a prior `READY`.
   - Wire in `run()` at the `opts.leg === 'complete'` branch (93), dispatching on `stop.kind` alongside `pickupCompleteLeg`.

**4. POD gate — confirm it covers BOTH entry points.**
The POD requirement lives in `driver.service.ts:226-229` (`DELIVERY_KINDS`, `POD_ERRORS.POD_REQUIRED`). But `run()` is the shared applier for the driver path **and** the dispatch/owner `/v1/route-stops/:id\\:complete` path. **Verify the owner/dispatch complete route cannot reach `deliveryCompleteLeg` without a captured `ProofOfDelivery`.** If it can, move/duplicate the POD assertion into the shared path (in `run()` before the complete leg, or at the top of `deliveryCompleteLeg`) so `DELIVERED` is unreachable without proof regardless of caller. Test both entry points.

**5. Payment path goes live.** No code change expected — `payment.service.ts:424-425` already does `DELIVERED → INVOICED` on paid. Add an e2e that pays a `DELIVERED` order and asserts `INVOICED`.

**6. Realtime teardown** — already handled: `run()` closes the customer tracking channel on any terminal stop (102-106). Delivery stops use the same terminal path; no change.

**Apps:** no new driver/customer screen — delivery stops already flow through the existing driver stop verbs + POD capture, and the customer `StatusTimeline` already renders `DELIVERED` (idx 12) and lights up once the status is real.

## Verify (proof — extend `apps/api/test/pod.e2e-spec.ts`)
Build an order to `READY` (drive it through Inc-30: `start-cleaning → send-to-qc → qc pass`), put it on a published route with a `DELIVERY` stop, then:
- publish → assert `Order.status = SCHEDULED_DELIVERY`;
- `depart` → assert `DELIVERY_EN_ROUTE`;
- `complete` **without** POD → 400 `POD_REQUIRED` (assert on BOTH the driver path and the dispatch path);
- capture POD → `complete` → assert `RouteStop.status = COMPLETED` **and** `Order.status = DELIVERED` **and** a `CustodyEvent(stage=DELIVERED)` exists for **every** item in `ITEM_ORDER_BY` order **and** every `Item.status = DELIVERED`;
- then pay → assert `INVOICED`.
Keep the existing POD/cross-driver 403 coverage green. Run `packages/shared` build + `apps/api` `tsc` + the full api e2e (assert no regression in `orders.e2e` / `pod.e2e`).

## Done = 
All the above green, logged to `CHANGELOG.md` + a dated `handoffs/2026-07-10-inc31-*.md`, **not committed-to-Railway yet** (batch deploy comes after Inc-32). Report proof (status at each hop, the POD-both-paths result, the custody/item assertions) for this chat to audit before Inc-32.
