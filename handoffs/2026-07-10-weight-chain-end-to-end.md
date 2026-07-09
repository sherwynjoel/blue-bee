# Handoff — 2026-07-10 · Inc-23: weight→price chain finished end-to-end (P0–P6)

**Branch:** `feature/s3-media-golive` · **Commits (this session, newest last):**
- `465cb43` P0 — Book → new catalog (card carries its backing service → pricingModel)
- `b8f9476` P2 — Driver weigh UI (offline-first) + driver-stop-scoped endpoint
- `6530a1c` P3 — Dashboard live weight + audited override (web console)
- `9acfb41` P4 — Customer live "Weighed X kg → $Y" line + specialty gate
- `b375e71` P5 — Re-quote after approval (explicit new §5.1 edge)
- (this commit) P6 — QC/no-stub sweep + full-chain e2e + fixes

Committed with ONLY their own paths. The **EAS-Android-enablement workstream** (eas.json/tsconfig/app.json/plugins, package.json, package-lock.json) is left untouched/uncommitted — not mine. The **PRD** (docs/laundry-platform-PRD.md) now carries the founder's §14.2 + my §5.1 re-quote branch (committed in P5).

---

## What shipped — the WHOLE chain is real end-to-end
Builds on Inc-21 (catalog) + Inc-22 (weight backend). Now: **customer books off a new catalog card → driver weighs & approves (offline-first) → hybrid price → dashboard + customer see it live → re-weigh after approval re-prices.** No stubs; every surface proven against the real DB/endpoints/socket/offline-queue.

- **P0 Book→catalog:** `HomeServiceCardView.serviceId` (the card's backing rate Service, null until priced); `GET /catalog/home` resolves it. Customer `Book` nav param += `{serviceId, serviceName, unit, kind}` (additive); HomeScreen card tap carries it; BookScreen focused composer. → the OrderLine references the card's backing Service, so the weigh gate reads the right `pricingModel` (no FIXED-default fallback).
- **P2 Driver weigh (offline-first):** driver isn't org-wide → new **`POST /v1/driver/stops/:id/weigh`** + `GET .../weight` (stop-ownership auth; the pricing gate runs org-system so a driver's approval can auto-price, audited to the driver). Refactored `WeighService` → `weighForOrder`/`weightViewForOrder`. Driver app: durable **`WeighOutbox`** (mirrors the proven `ChatOutbox`) + `FileWeighOutboxStore` + `useWeighQueue` + `WeighScreen` + a "Weigh load" button + the `Weigh` route.
- **P3 Dashboard live + override:** OrderDetail `WeightPanel` — authoritative weight + weigh point + who/when + append-only history + price line, LIVE via the `/live/fleet` `weight` socket (REST re-read on event). OWNER/PLANT audited override → `POST /orders/:id/weigh` (writes a NEW capture; history preserved).
- **P4 Customer live line:** OrderDetail "Weighed X kg → $Y" (FIXED) / pending (no fake number) / the existing quote card for FROM_MEASURED. `GET /orders/:id/weight` now allows the OWNING customer (scoped read enforces it). Live over the **order-room** channel (`getMessagesChannel` token — the gateway joins the order room for it; the tracking token doesn't).
- **P5 Re-quote after approval:** new **§5.1 branch `QUOTE_APPROVED → QUOTED`** (added to `SPECIALTY_ORDER_TRANSITIONS` + `canTransitionOrder` + the PRD, NO invented status). A plant re-weigh of an approved order re-prices FIXED (auto-re-approve, audited "re-priced on plant re-weigh") or re-opens FROM_MEASURED for customer re-approval.

## Proof (evidence per phase)
- **P0:** booked from all 8 cards → each OrderLine → right service/category/pricingModel (DB join); rates reverted clean.
- **P2:** driver curl — weigh 7.5kg → append-only capture, idempotent replay = same id, re-weigh (new key) = new capture, RBAC 403 for a customer; **offline-queue unit test 6/6** (approve OFFLINE → persisted → simulated relaunch restores → ONLINE flush reuses the key; permanent-fail; FIFO).
- **P3:** a dashboard socket on `/live/fleet` **received the `weight` event the instant a weigh was approved**; owner override kept the old capture.
- **P4:** the customer socket (order-room token) **received the live weight**; customer GET `/weight` → 200 (own order).
- **P5/full-chain e2e:** weigh e2e **7/7** — incl. re-quote (FIXED re-price $21→$28; mixed re-open→re-approve) + the full chain (book→weigh→$21→visible on BOTH surfaces→re-weigh→$31.50).

## QC gate (P6)
- **No-stub sweep: CLEAN** — 32 Inc-23 source files, zero `stub|placeholder|fake|FIXME|not implemented|hardcoded|dummy|TODO|return-null-shortcut`.
- **Honesty firewall:** seed ships `priceFrom = NULL` + no rate; test rates are hidden test-only fixtures; no fabricated weight/price shipped.
- **Regression (each spec GREEN IN ISOLATION):** api unit 230/230 · web 137→141 · customer 98→105 · driver 43→49 · weigh e2e 4→7 · catalog-dryclean red→9/9.
- **Two fixes surfaced by the gate:** (1) **my Inc-21 regression** — `/catalog/dryclean` was children-only, so console-created garment categories vanished from the picker AND would have polluted the customer Home menu; `createCategory` now nests garment categories under the Dry Cleaning card. (2) a **pre-existing seed gap** (not Inc-23) — seeded the `+14165550006` Driver row (care-home e2e depended on `tracking.e2e` creating it first).

## ⚑ Honest gap (flagged; PRE-EXISTING, not Inc-23; out of scope)
The full `jest --config jest-e2e.config.js --runInBand` run has **cross-spec contamination**: `care-home-linen` (4 route/stop tests) + `recurring` fail in the batch but **PASS in isolation** (recurring 12/12, catalog-dryclean 9/9, weigh 7/7). They rely on other specs' shared-DB side-effects (driver routes/stops). I never touched their code; this is a pre-existing test-suite-isolation issue. **Recommendation:** make the e2e suite self-isolating (each spec seeds its own driver/routes or resets between files) — a separate hygiene task.

## Run it
- Infra: `npm run infra:up` (pg:5432 + minio:9000; brew redis:6379). Reset: `cd apps/api && npx prisma migrate reset --force --skip-seed && npx prisma db seed`.
- Tests: api unit `npx jest`; e2e `npx jest --config jest-e2e.config.js --forceExit --runInBand weigh` (or a single spec — all pass in isolation). web/customer/driver: `npm run typecheck` + `npx jest` per app.
- No new npm deps → no package-lock churn (EAS `npm ci` landmine untouched).

## Next
- Founder: enter real CAD rates in `/catalog` (still NULL in seed) to light up the live chain in the demo.
- Suite hygiene: fix the pre-existing e2e cross-spec contamination (above).
- Not built (Phase-1 discipline): prepaid packs / subscriptions / wallet / referrals.
