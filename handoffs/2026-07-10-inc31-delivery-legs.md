# Handoff — Inc-31: delivery legs (`READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED`)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Branch:** `feature/s3-media-golive`
**App:** `apps/api` · **Status:** ✅ Built, tested, e2e-proven end-to-end (real MinIO + Postgres). **Not committed. NOT deployed** — batched with Inc-28/29/30 (+Inc-32) for one `railway up`.
**Step 3 (Ratings/CSAT):** this is **Inc-31 of 30→31→32**. Inc-30 (production → `READY`) is merged. This makes `DELIVERED` reachable; **Inc-32** (ratings) gates on it.

> **If you read one thing, read §2** — the POD hole this increment had to close before it was safe to ship.

---

## 1. What shipped (mirrors the pickup legs one-for-one)

No lifecycle edits — every edge below was already in `SPECIALTY_ORDER_TRANSITIONS` (`lifecycle.ts:40-42`).

1. **Scheduling** — `route.service.ts` publish loop. Already advanced pickups `REQUESTED → SCHEDULED_PICKUP`; now also advances a `DELIVERY/BOTH` stop whose order is `READY` → `SCHEDULED_DELIVERY` (atomic, audited, `reason: 'scheduled onto a published route'`). The dedup set is re-keyed **per `(orderId, leg)`** (`${orderId}:pickup` / `${orderId}:delivery`) so a `BOTH` stop can schedule the leg its order-state is at, and never both legs for one order in one publish.
2. **Depart** — `deliveryDepartLeg` (mirrors `pickupDepartLeg`): `DELIVERY/BOTH` stop, order `SCHEDULED_DELIVERY` → `DELIVERY_EN_ROUTE`.
3. **Complete** — `deliveryCompleteLeg` (mirrors `pickupCompleteLeg`): order `DELIVERY_EN_ROUTE → DELIVERED`, then an append-only `CustodyEvent(stage=DELIVERED, deviceId='route-stop-delivery')` **per item in `ITEM_ORDER_BY` order** + `Item.status = DELIVERED`.
4. **Payment path goes live** — no code change. `payment.service.ts:maybeAdvanceToInvoiced` already does `DELIVERED → INVOICED` on a confirmed payment; it was dead because nothing reached `DELIVERED`.
5. **Realtime teardown** — unchanged. `run()` already closes the customer tracking channel on any terminal stop; delivery stops use the same path.

Both new legs are called from `run()` **alongside** the pickup legs and **self-guard on kind + order-state**, so a PICKUP stop skips the delivery legs and a DELIVERY stop skips the pickup legs; a `BOTH` stop fires exactly the one leg its order-state allows.

**No app change** — the driver already drives `depart/arrive/start/complete` + POD capture (delivery stops use the same verbs); the customer `StatusTimeline` already renders `DELIVERED` (idx 12). Both light up now that the status is real.

---

## 2. ⚑ The POD hole — found, closed, tested on both paths

`route-stop.service.ts:run()` is the shared applier behind **two** callers:

- the driver duty-loop — `/v1/driver/stops/:id/complete`
- the ops/dispatch — `/v1/route-stops/:id:complete` (`@Roles(OWNER, DISPATCHER)`)

The POD requirement lived **only** in the driver layer (`driver.service.ts:226`), and that file's own comment said so: *"Ops `/v1/route-stops` keeps its admin-override complete, ungated."* That was harmless while the ops complete only ran `pickupCompleteLeg` (a no-op on delivery stops). **The moment `deliveryCompleteLeg` joined the shared `run()`, the ops path could drive a delivery stop to `DELIVERED` with no proof of delivery at all.**

Fix: the POD assertion is **moved into the shared path**. `run()` now checks for a captured `ProofOfDelivery` *before the transaction* whenever a `DELIVERY/BOTH` stop is completing — from any caller — throwing a clean 400 `POD_REQUIRED`, machine untouched. The driver layer keeps its own (slightly earlier) pre-check, so both paths 400 identically. To stop the two layers ever disagreeing about "what is a delivery stop," `DELIVERY_KINDS = {DELIVERY, BOTH}` (previously private to `driver.service.ts`) is **promoted to `logistics/stop-kinds.ts`** and imported by both.

The e2e asserts the block on **both** entry points, and that neither touched the machine (stop still `IN_PROGRESS`, order still `DELIVERY_EN_ROUTE`).

---

## 3. ⚑ Decisions / notes (flagged, not silent)

1. **`Item.status` set UNCONDITIONALLY to `DELIVERED`** — no guard on a prior `READY`. Per the Inc-30 audit there is no Item state machine and items sit at `INSPECTED`/`RECEIVED` at delivery; the delivered order is the authoritative signal that each item is delivered. (This is the per-item denorm Inc-30 deliberately deferred — Inc-31 sets it, and only for `DELIVERED`.)
2. **`BOTH`-stop scheduling** — keyed per `(orderId, leg)` so the pickup key can't swallow the delivery leg. A `BOTH` stop on a `REQUESTED` order schedules pickup; on a `READY` order schedules delivery. An order is in exactly one state, so never both in one publish.
3. **The pay→INVOICED proof lives in `payments.e2e-spec.ts`, not `pod.e2e`.** `pod.e2e` boots via `createRealtimeTestApp`, which does **not** enable `rawBody`; the signed Stripe webhook needs the raw bytes to verify, so a webhook fired there would 400 on signature. Rather than mutate the shared realtime factory (it already carries another increment's in-flight edits), the assertion goes where `rawBody` + `StripeEventVerifier` already live. `pod.e2e` proves the real path **to** `DELIVERED`; `payments.e2e` proves `DELIVERED → INVOICED`; the seam between them is the same `OrderStateMachine`.

---

## 4. Verification (proof)

- api `tsc` clean. `packages/shared` unchanged (no schema/lifecycle edits — `stop-kinds.ts` is api-internal).
- **`pod.e2e-spec.ts` (extended):** a fresh 2-item order driven the whole real spine to `READY`, routed as a `DELIVERY` stop, then:
  - publish → `Order.status = SCHEDULED_DELIVERY` ✅
  - depart → `DELIVERY_EN_ROUTE` ✅
  - complete **without** POD → **400 `POD_REQUIRED` on the driver path AND the dispatch path**; stop still `IN_PROGRESS`, order still `DELIVERY_EN_ROUTE` ✅
  - capture real POD → complete → `RouteStop.status = COMPLETED` + `Order.status = DELIVERED` + a `CustodyEvent(DELIVERED)` for **every** item in `ITEM_ORDER_BY` order (exactly one each, `deviceId='route-stop-delivery'`) + every `Item.status = DELIVERED` ✅
  - existing POD / idempotency / cross-driver-403 / PICKUP-unaffected cases stay green.
- **`payments.e2e-spec.ts` (extended):** a `DELIVERED` order + signed `payment_intent.succeeded` → `Order.status = INVOICED` + PAID invoice + mirrored `paymentStatus` ✅
- **FULL api e2e: 418 → 426/426 (34 suites)**, `--runInBand --forceExit`, incl. `logistics` / `driver` / `orders` / `tracking` / `recurring` — **zero regression**.

---

## 5. Files touched

```
apps/api/src/logistics/stop-kinds.ts        (new — shared DELIVERY_KINDS)
apps/api/src/logistics/route.service.ts     (publish loop: + delivery scheduling, per-(orderId,leg) dedup)
apps/api/src/logistics/route-stop.service.ts(POD gate in run() + deliveryDepartLeg + deliveryCompleteLeg)
apps/api/src/driver/driver.service.ts       (import DELIVERY_KINDS from stop-kinds)
apps/api/test/pod.e2e-spec.ts               (delivery-legs end-to-end + POD both paths + custody/item)
apps/api/test/payments.e2e-spec.ts          (DELIVERED → INVOICED; makeApprovedOrder takes a status)
CHANGELOG.md
handoffs/2026-07-10-inc31-delivery-legs.md  (this file)
```

---

## 6. For the audit chat → Inc-32

`DELIVERED` is now real and reachable end-to-end (POD-gated), and the custody chain + `Item.status` + `DELIVERED → INVOICED` are all proven. Inc-32 (ratings/CSAT) gates on `DELIVERED`-or-later and adds the `RATE_REQUEST` push — the natural call site is right after the status apply in **`deliveryCompleteLeg`** (`route-stop.service.ts`). Add it there in Inc-32 (the brief prefers filling it in Inc-32 so Inc-31 carries no dead code — done: no stub left here).
