# Handoff — Inc-30: production advance (`QUOTE_APPROVED → IN_CLEANING → QC → READY`)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Branch:** `feature/s3-media-golive`
**Apps:** `apps/api` + `apps/web` · **Status:** ✅ Built, tested, e2e-proven against the real seeded dev Postgres. **Not deployed** (founder's call). **Not committed** (code only, per the standing pattern).
**Step 3 (Ratings/CSAT) sequencing:** this is **Inc-30 of 30→31→32**. It unblocks Inc-31 (delivery legs → `DELIVERED`), which unblocks Inc-32 (ratings).

> **If you read one thing, read §5** — the e2e that drives the whole plant spine against the real DB and
> asserts both the `Order.status` row and the matching `AuditLog` at every hop.

---

## 1. The gap this closes

The audit in the brief held: **no service in `apps/api/src` ever advanced an order past `QUOTE_APPROVED`.**
The §5.1 graph (`SPECIALTY_ORDER_TRANSITIONS`, `packages/shared/src/lifecycle.ts:34-39`) and
`OrderStateMachine` already *permit* the back-half —

```
QUOTE_APPROVED → IN_CLEANING → QC → READY
IN_CLEANING ⇄ REWASH        QC → REWASH
```

— but nothing ever *called* `apply()` toward any of them. The plant half was legal-but-dead enum. So this
increment **wires transitions only**: zero lifecycle edits, every target state already in `OrderStatus`,
nothing invented.

---

## 2. What shipped

**Backend** (`apps/api/src/orders/`):

- **`production.service.ts` (new)** — `ProductionService`, mirroring `IntakeService.schedulePickup`: resolve
  + scope the order via `OrderAccessService.requireOrderForWrite` (→ 404 cross-org / 403 cross-account),
  then ONE audited `OrderStateMachine.apply` inside a `$transaction`. Methods:
  - `startCleaning` → `IN_CLEANING` (legal from `QUOTE_APPROVED` **and** `REWASH` — the machine validates the
    from-state, so the same verb starts and restarts).
  - `sendToQc` → `QC`.
  - `recordQc({ result, reason? })` → `READY` (pass) or `REWASH` (fail; reason audited).
  - `rewash({ reason })` → `REWASH` (a rewash pulled mid-cleaning; `QC→REWASH` is the `recordQc(fail)` path).
- **`orders.controller.ts`** — four endpoints, `@Roles(OWNER, CSR, PLANT_OP)`, `@HttpCode(200)`, idempotency
  via the class-level interceptor:
  `POST /v1/orders/:id/{start-cleaning, send-to-qc, qc, rewash}`.
- **`orders.module.ts`** — `ProductionService` registered as a provider.
- **`packages/shared/src/orders.ts`** — `startCleaningSchema`, `sendToQcSchema`, `recordQcSchema`
  (`result: 'pass'|'fail'` + `.refine` requiring a reason on fail), `rewashSchema` (reason required) + DTO
  types. Exported via the existing `export * from './orders'`. **`packages/shared` was rebuilt** (both api
  and web jest + tsc resolve `@blue-bee/shared` from `dist`).

**Console** (`apps/web`):

- **`components/order/ProductionActions.tsx` (new)** — a header action group that renders **only the legal
  next action(s) for the current status** (so an illegal call is never issued from the UI). A 409 surfaces
  as *"This order just moved on — refresh to see its current step."* (`ApiError.isConflict`). Gated on
  `can.production(me)`; the server independently re-checks the same `@Roles`, so this is UX only. Rewash /
  QC-fail open a reason-required modal (mirrors `OrderActions`' `HoldModal`).
- **`components/OrderDetail.tsx`** — `<ProductionActions>` rendered beside `<OrderActions>` in the header.
- **`lib/api-client.ts`** — `startCleaning` / `sendToQc` / `recordQc` / `rewashOrder`.
- **`lib/rbac.ts`** — `PRODUCTION_ROLES` + `can.production`, mirroring the server `@Roles(OWNER, CSR, PLANT_OP)`.

No customer/driver-app change (production is internal; the customer `StatusTimeline` already renders these
milestones and will light up as the order moves).

---

## 3. ⚑ Decisions vs the brief — flagged, not silent

1. **Endpoint decomposition — one verb per transition.** The brief listed both a `qc` (pass/fail) *and* a
   separate `ready` endpoint, i.e. two routes for the single `QC→READY` transition. **Folded `ready` into
   `qc(pass)`**: `qc` is the QC-station decision (`pass → READY`, `fail → REWASH`). Result: exactly one verb
   per real transition, and the console offers exactly one legal action per state. **All six** production-region
   edges are driven — `QUOTE_APPROVED→IN_CLEANING`, `REWASH→IN_CLEANING`, `IN_CLEANING→QC`, `QC→READY`,
   `QC→REWASH`, `IN_CLEANING→REWASH`.

2. **Strengthened the QC-fail / rewash contract.** The brief made the reason optional. A QC **failure** now
   *requires* a reason (≥3 chars) and `rewash` requires one too — sending work backward must be accountable,
   never a silent bounce (consistent with `holdOrderSchema`). It lands in the audited `after`.

3. **Order-level only — `Item.status` deliberately untouched.** The brief's Inc-30 verify asserts
   `Order.status` + a matching `AuditLog` and says nothing about per-item status. The `ItemStatus`
   `IN_CLEANING/QC/READY` denorm stays out of scope (**Inc-31** sets `Item.status = DELIVERED` on delivery).
   → *Audit decision point:* wire the per-item cleaning/QC denorm now, or leave it? I left it out to match the
   stated verify exactly and keep the slice tight.

4. **Cross-account 403 is not reachable here — stated honestly.** All three production roles are ORG-wide, so
   `requireOrderForWrite`'s scoped read always sees the order; the 403-cross-account branch can't fire for an
   org-wide principal (an account-confined caller is stopped one layer earlier at the RBAC guard with
   `forbidden_role`). The e2e therefore proves the gates that ARE reachable: RBAC 403, cross-org 404, and the
   illegal-transition 409s.

---

## 4. Reuse (no new machinery)

- Every status write goes through `OrderStateMachine.apply` — the atomic conditional `updateMany(where status
  = from)` (loser → 409) that already writes the `AuditLog`. No direct `order.status` write anywhere.
- Scope via `OrderAccessService.requireOrderForWrite` (cross-org 404 / cross-account 403), exactly like intake.
- No `lifecycle.ts` change — every edge was already in `SPECIALTY_ORDER_TRANSITIONS`.

---

## 5. Verification (proof)

- `packages/shared` rebuilt; `apps/api` `tsc` **clean**; `apps/web` `tsc` **clean**.
- **`apps/api/test/production.e2e-spec.ts` (new) — 6/6**, real app + seeded Postgres, minted JWTs:
  - Happy path `QUOTE_APPROVED → IN_CLEANING → QC → READY`: each hop asserts the `Order.status` row **and** a
    matching `STATUS_TRANSITION` `AuditLog` (JSON-path `after.status`).
  - Rewash branch: `qc fail → REWASH → start-cleaning → IN_CLEANING`; fail-without-reason → 400.
  - Mid-cleaning `rewash` (reason required); reason-less → 400.
  - Illegal jumps → 409 `illegal_transition`, row untouched (start-cleaning from `QUOTED`; qc from
    `IN_CLEANING`; send-to-qc from `QUOTE_APPROVED`).
  - RBAC: FINANCE/DISPATCHER/RESIDENTIAL_CUSTOMER → 403 `forbidden_role`; CSR/PLANT_OP → 200. Cross-org → 404
    `order_not_found`.
  - Concurrent `start-cleaning` → exactly one 200 / one 409.
- **`apps/api/test/orders.e2e-spec.ts` — 17/17 unchanged** (no regression from the controller/module change).
- **`apps/web/components/order/ProductionActions.test.tsx` (new) — 9/9**: right CTA per status, correct client
  call + body (incl. the fail-reason modal), blank-reason guard, null render for a non-production role / status,
  409 → "moved on".

Run with `--runInBand --forceExit` (the known Redis/outbox exit-hang; jest force-exits after green).

---

## 6. Deploy

`railway up` (api + web) — **console-only, no EAS app rebuild.** Founder's call; **not deployed** here. The
customer timeline becomes real once **Inc-31** wires delivery to `DELIVERED`; batch any customer EAS build then.

---

## 7. Files touched

```
packages/shared/src/orders.ts                                  (+ dist rebuilt)
apps/api/src/orders/production.service.ts                      (new)
apps/api/src/orders/orders.module.ts
apps/api/src/orders/orders.controller.ts
apps/api/test/production.e2e-spec.ts                           (new)
apps/web/components/order/ProductionActions.tsx                (new)
apps/web/components/order/ProductionActions.test.tsx           (new)
apps/web/components/OrderDetail.tsx
apps/web/lib/api-client.ts
apps/web/lib/rbac.ts
CHANGELOG.md
handoffs/2026-07-10-inc30-production-advance.md                (this file)
```

---

## 8. For the audit chat → Inc-31

An order can now reach **`READY`** through the console (`start-cleaning → send-to-qc → qc pass`) or a fixture.
Inc-31 slots the delivery analog (`READY → SCHEDULED_DELIVERY`) into the route-publish loop and mirrors the
pickup legs for depart/complete — POD-gated — to write the `DELIVERED` custody chain and light up the existing
`DELIVERED → INVOICED` payment path. Open question carried forward: whether Inc-31 should also advance
`Item.status` through the cleaning/QC stages (see §3.3) or only set `DELIVERED` at delivery as planned.
