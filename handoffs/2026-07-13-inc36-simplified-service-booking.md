# Inc-36 — Simplified customer service booking (one service → one measure → book)

**Date:** 2026-07-13 · **Working folder:** `/Volumes/Gowtham/Blue Bee` (the LIVE repo) · **Surfaces:** `apps/customer`, `apps/api` (seed), `apps/web` (verified), `apps/driver` (verified)
**Status:** BUILT + verified end-to-end. **Not deployed** (no `railway up`, no EAS).
⚠️ `/Volumes/Gowtham/bluebee-integration` — **untouched** (0 changed files). It is a *stale git worktree* of this repo (`gitdir: …/Blue Bee/.git/worktrees/…`, frozen Jun 27) with **no `HomeScreen` and no service-menu code at all**. Editing it is a footgun; consider `git worktree remove`.

---

## The actual root cause (not what the brief assumed)

The brief expected a missing `KG` unit and a hardcoded sub-catalog. **Neither was true.** The real cause was one line:

`catalog.service.ts` → `serviceId: c.services[0]?.id ?? null`

**None of the 8 Home cards had a backing `Service`** (the founder never entered a rate), so `GET /v1/catalog/home` returned `serviceId: null` for every card → `HomeScreen` navigated `Book` with **no params** → BookScreen fell into its **general composer** (item-type chips + service chips + `DrycleanPicker` + a generic size field). *That* was the complexity on screen.

**Already existed, not rebuilt:** `KG` / `PER_KG` / `PER_LB` / `PER_MEASURE` / `WASHFOLD` enums; the console rate editor (`ServiceMenuAdmin` + `PATCH /v1/catalog/service-menu/:id`, which **upserts the backing Service** via `backingServiceUnit()` / `isWeightPricingUnit()`); the driver weigh → kg-canonical → quote path.
➡️ **No migration, no enum change, no new console/driver feature was needed.**

## Changes

### Catalog data (`apps/api/prisma/seed-catalog.ts`) — the fix
- **Every card now gets a backing `Service`** (deterministic id `5e000001-…`), so a tap **always** lands in the focused checkout.
- Units corrected: **Wash & Iron `PER_ITEM` → `PER_KG`**, **Dry Cleaning `PER_ITEM` → `PER_LB`**. (Wash & Fold PER_KG, Rug/Carpet/Upholstery/Blinds FROM_MEASURED/PER_MEASURE unchanged.)
- **`Ironing only` kept `PER_ITEM`** — listed back for confirmation, not guessed.
- Backing unit + vertical are derived with **the same shared helpers the console uses**, so seed and console can never diverge.
- **STARTER rates** (configurable placeholders, clearly commented — *not* official prices) so the estimate has real math. **`priceFrom` stays NULL** → the grid honestly shows **"Get a quote"** until the founder sets a real CAD price. `update` re-asserts *structure* (unit/model) but **never** `baseRate`/`priceFrom` — a re-seed cannot clobber a founder-set rate.

### Customer app
- **`HomeScreen`** — feature chips (`WASH · TUMBLE-DRY · FOLDED`) no longer rendered (field stays in schema/console). The Inc-33 **"Book a pickup" button removed** — it was the *only* door into the general composer. The grid *is* the picker.
- **`BookScreen`** — rewritten as **one service, one measure**: a single measure input labelled by the card's `PricingUnit` (kg / lb / sq ft / items — never hardcoded), a **live estimate the moment you type** (no "Add" step), address picker, pickup-slot picker, book. **Deleted:** item-type chips, service chip list, `DrycleanPicker` (component + test removed — orphaned), the staged-items list.
- **General composer is unreachable:** Book with no service is a dead end back to the grid; `OrdersScreen`'s CTAs now route to the Service grid (`Home` added to `RootStackParamList`, additive).
- Estimate copy is honest: *"Final quote confirmed after we weigh/measure at pickup."*

### Web + driver — verified, not rebuilt (already wired)

## Proof (run log)

**Every card now carries a backing service** (`GET /v1/catalog/home`): all 8 → `serviceId` non-null; units `PER_KG, PER_KG, PER_LB, PER_ITEM, PER_MEASURE ×4`.

**(a) Wash & Fold (kg)** — booked 6 kg × $3.50 → app estimate **$18.90–$24.15**; server `OrderLine.measure=6, rate=3.5000, amount=21.00`, `estimateRange 18.90–24.15` (app and server agree).
**(b) Carpet (sqft)** — booked 40 sqft × $4.00 → **$144.00–$184.00**; `OrderLine.measure=40, rate=4.0000, amount=160.00`.

**Console round-trip** — `PATCH /v1/catalog/service-menu/{wash&fold}` `{rate: 4.25, priceFrom: 4.25, description: …}` → `GET /v1/catalog/home` immediately shows the new description + `priceFrom 4.25` (card flips "Get a quote" → "from $4.25 / per kg"), and `GET /v1/services` shows the backing rate **3.50 → 4.25**.

**Driver weigh → authoritative quote** (real dispatch, real order):
route → pickup stop → driver `POST /v1/driver/stops/:id/weigh` **6.40 kg** (append-only capture; order → `PICKED_UP`; weight denormalized onto the item) → inspect → `INTAKE_INSPECTED` → plant confirm → **hybrid pricing gate `auto_approved`** → **6.4 kg × $4.25 = $27.20 + $3.54 HST = $30.74**, order → `QUOTE_APPROVED`. *The quote priced at the founder's console rate, not the booking-time rate — server-authoritative.*

## Verification
- **typecheck 6/6** (shared, api-client, api, web, customer, driver) · **lint 6/6**
- **Tests:** customer **197**, driver **49**, web **214**, api-client **7**, api unit **338** — all green.
- **Full API e2e on a FRESH seeded DB: 456/456 (37/37 suites).**
- On the *shared dev* DB the e2e is 455/456: the one red is the **known pre-existing** `accounts-portal › orders?limit=100` artifact (Account B has **108** accumulated orders from repeated runs, so a seeded order fell to page 2). Unrelated to this change (my bookings were on Account A) and **green on a fresh DB**.

## Lint debt fixed in passing (pre-existing, not caused here)
`apps/driver` ChatScreen (unused import) + WeighScreen (`exhaustive-deps` disable for a rule the driver eslint config doesn't load); `apps/customer` ChatScreen / OrderDetailScreen / ReferScreen unused vars. Workspace lint was already red before this change.

## Follow-ups for the founder
1. **Set real CAD rates + `priceFrom`** in `/catalog`. Until then cards honestly show "Get a quote" (the starter rates only drive the in-checkout estimate).
2. **Confirm `Ironing only` stays `PER_ITEM`** (not guessed).
3. Optional: blank the `features` arrays in the console (customer app no longer renders them).
4. `WASHFOLD` (consumer wash-fold) is now live in the customer flow — the PRD defers this vertical to a later phase. The enum already existed; **scope note only**, no other Phase-2/3 feature was built.
