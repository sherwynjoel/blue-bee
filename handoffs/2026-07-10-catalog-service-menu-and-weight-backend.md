# Handoff — 2026-07-10 · Inc-21 Catalog service menu (full) + Inc-22 Weight→price (backend only)

**Branch:** `feature/s3-media-golive` · **Commits (this session):**
- `5d65ae4` feat(catalog): Inc-21 service menu — 8 Home cards + per-unit rate model
- `3649576` feat(orders): Inc-22 weight→price backend — append-only weigh capture + hybrid pricing

Both committed with ONLY their own paths. The pre-existing **EAS-Android-enablement workstream** (apps/customer|driver eas.json/tsconfig/app.json/plugins, package.json, package-lock.json, expo-env.d.ts, UX-REDESIGN-BRIEF.md, docs/feature-analysis, the other 2026-07-09 handoffs) was left **untouched/uncommitted** — not mine to commit.

---

## What shipped

### Inc-21 — Catalog service menu (FULL: model + migration + seed + endpoint + console rate editor + Home footers)
Implements the customer-app-feature-analysis **P0 "catalog content."** The "catalog" that was already committed (Inc-17/20) turned out to be a **dry-clean garment sub-catalog**, NOT the 8-service menu the prompt specified — so this reconciles the two.

- **Reconciliation (founder-approved, AskUserQuestion):** *extend* `ServiceCategory` into the 8-service Home menu; the per-kg/per-item **RATE lives on a backing `Service`** the console creates on first rate entry; **Dry Cleaning nests** the existing Shirts/Outerwear/Formalwear garment sub-catalog via a new `parentId` self-relation.
- **Schema:** `ServiceCategory` += `pricingModel {FIXED|FROM_MEASURED}`, `unit {PER_ITEM|PER_KG|PER_MEASURE}`, `priceFrom Decimal?` (nullable), `currency`, `parentId`. `ServiceUnit` += `KG`. New enums PricingModel/PricingUnit (shared↔Prisma 1:1). Migration `20260709174748_catalog_service_menu_inc21` — additive; **phantom DROP INDEX lines omitted per the Inc-19 convention** (raw NULLS-NOT-DISTINCT + PostGIS-GiST indexes; verified restored after a `migrate reset`).
- **SCOPE PIVOT:** intentionally introduces consumer **Wash & Fold + Wash & Iron**, beyond the specialty-only MVP. **⚑ PRD §14.1 ("no consumer wash-fold") is FLAGGED for update** — NOT rewritten here. Founder to update the PRD.
- **HONESTY FIREWALL:** seed ships `priceFrom = NULL` + **no rate** for all 8 → Home shows **"Get a quote"** until the founder enters real CAD prices in the console. No sample/placeholder price anywhere customer-visible.
- **API:** `GET /v1/catalog/home` (the 8 cards) · `GET /v1/catalog/dryclean` (restored to the Dry Cleaning garment picker — split so **BookScreen keeps working**) · OWNER/FINANCE `GET`/`PATCH /v1/catalog/service-menu` (the rate editor; org-scoped + audited). OpenAPI published.
- **Console:** new `ServiceMenuAdmin` on `/catalog` — **where real CAD prices get entered** (rate + "from" price + description/features/icon/unit/pricingModel/active/sortOrder).
- **Customer:** HomeScreen reads `/catalog/home`; footer variants — `from $X` ·per item / ·per kg / ·measured at pickup / **Get a quote** (null price); icon map += rug/carpet/sofa/blinds.

### Inc-22 — Weight → price (BACKEND ONLY; driver/dashboard/customer UIs deferred to a later session)
- **Model:** `WeighPoint {PICKUP|PLANT}` + **append-only** `WeightCapture` (scalar refs like the LinenMovement ledger; DB trigger `weight_capture_append_only` reusing `bluebee_block_mutation` blocks UPDATE/DELETE). Authoritative weight = the most recent capture; a re-weigh is a NEW capture, old retained, the switch audited. Migration `20260709183518_weight_capture_inc22` (additive; phantom drops omitted; trigger + 3 raw indexes verified).
- **Pricing (reuses the existing quote lifecycle — NO invented statuses):** `deriveMeasure` += KG (reads `Item.measurements.weightKg`); `computeQuote` += a **configurable minimum-order floor** (`Organization.billing_config.minOrderCents` → env `MIN_ORDER_CENTS` → 0). The weigh writes the append-only capture, denormalizes the weight onto the item, then the **hybrid gate**: all-FIXED → build (measure × published rate + floor) + **AUTO-APPROVE** (audit note "auto-priced at published rate") → `INTAKE_INSPECTED → QUOTED → QUOTE_APPROVED`; any FROM_MEASURED specialty line → quote **SENT** (customer approves in the existing card); mixed → FIXED priced, specialty waits.
- **API:** idempotent `POST /v1/orders/:id/weigh` (OWNER/CSR/PLANT_OP/DRIVER/DISPATCHER) + `GET /v1/orders/:id/weight` (authoritative + append-only history). OpenAPI published.
- **Realtime:** `WS_EVENTS.WEIGHT` + `RealtimePublisher.publishWeight` → the FLEET dashboard room + the order's token-scoped customer room (§12.2). REST is source of truth; socket is the live push.

---

## Proof (evidence, not "should work")
- **api unit 230/230** (was 225; +5 computeQuote min-order-floor tests), **29 suites green**; **weigh e2e 4/4** (FIXED PER_KG → auto-priced 6kg×$3.50 subtotal $21.00 → QUOTE_APPROVED + audit note; mixed wash+rug → quote SENT $254 subtotal → customer approves; idempotency + re-weigh append-only; **trigger blocks UPDATE/DELETE**).
- **web 137/137**, **customer 102/102** (was 98; +4 HomeScreen footer/state tests). `tsc` clean on api/web/customer/shared.
- **curl** `GET /v1/catalog/home` = 8 cards, every `priceFrom: null`. Owner rate round-trip: set 3.50/kg → customer card `priceFrom` 21.00 → reverted to null (DB left clean). Customer → **403** on the owner-only `/catalog/service-menu`.
- **curl** `POST /v1/orders/:id/weigh {weightKg:6,weighPoint:PLANT}` → `{pricing:{status:"auto_approved", total:"23.73", orderStatus:"QUOTE_APPROVED"}}` ($21.00 + 13% HST); `GET …/weight` returns authoritative 6.00 kg + history.
- **No new npm dependencies added** → no package-lock churn (the EAS `npm ci` lockfile landmine is not touched by this session).

---

## ⏭ NEXT SESSION — the founder's STOP point (do these before B's UIs)
1. **Enter real CAD rates** in the console `/catalog` → Service menu (per-kg for Wash & Fold, per-item for wash&iron/dry-clean/ironing, per-measure anchors for the specialty cards) + a "from" price per card. Optionally set a min-order floor (`billing_config.minOrderCents`).
2. **Verify one real weight→price reconciliation** (weigh a wash order → confirm the auto-priced amount matches your rate).
3. THEN build **Inc-22 P2–P4 UIs**: driver weigh + offline queue (clone `PodScreen`/`ChatOutbox`); dashboard live weight + price + history + audited override; customer live "Weighed X kg → $Y" line. Reuse `WS_EVENTS.WEIGHT`.
4. **Update PRD §14.1** to reflect the consumer wash-fold expansion.

## Known TODOs / limitations (deferred, honest)
- **Re-price after QUOTE_APPROVED:** a plant re-weigh records the new authoritative weight + audits the switch, but does NOT re-open an already-approved quote (§5.1 has no `QUOTE_APPROVED → INTAKE_INSPECTED` edge). Needs a REWASH-style re-quote branch.
- **kg banding:** pricing is exact `measure × rate` + the order-level floor (TODO note left in `quote-calc.ts` if banding is wanted).
- **Booking→new catalog:** the Book flow still references legacy service ids; wiring booking to the new backing rate services is a later step (the weigh gate reads `service.category.pricingModel`, defaulting no-category services to FIXED).

## Local dev/DB notes
- Infra up via `npm run infra:up` (postgres:5432 emulated amd64 + minio:9000; brew redis on :6379). DB reset+replayed clean through Inc-22, then `npx prisma db seed`.
- The **weigh e2e leaves its TEST fixtures** (CAT_WF/SVC_WF KG, CAT_RUG/SVC_RUG SQFT) in the dev DB — clearly labelled, `active:false`, parented under Dry Cleaning so they never surface on Home/console/picker. A `migrate reset` + seed clears them.
- Run it all: `cd apps/api && npx prisma migrate reset --force --skip-seed && npx prisma db seed`; unit `npx jest`; e2e `npx jest --config jest-e2e.config.js --forceExit --runInBand`.
