# Handoff — 2026-07-10 · Inc-24: catalog editor gaps (PER_LB · icon picker · reorder)

**Branch:** `feature/s3-media-golive` · Builds on Inc-21 (service menu) + Inc-22/23 (weight → price).
Scope was exactly the three gaps; nothing else in the editor was touched. No stubs; the honesty firewall
(`priceFrom` founder-set, no invented data) is untouched.

---

## 1) PER_LB — per-pound pricing, kilogram capture

- `PricingUnit += PER_LB` (packages/shared enum + Prisma enum). The Zod DTO is `z.nativeEnum(PricingUnit)`,
  so it accepted the new member with no schema edit.
- Migration `20260710040000_pricing_unit_per_lb_inc24` — a single additive
  `ALTER TYPE "PricingUnit" ADD VALUE 'PER_LB'`. Hand-written per the **Inc-19 convention** (the phantom
  `DROP INDEX` lines Prisma emits for the raw NULLS-NOT-DISTINCT + PostGIS-GiST indexes are omitted).
  **Drift verified:** a `prisma migrate dev --create-only` probe emitted ONLY those 3 phantom drops and no
  enum/table work → schema and migrations agree. Probe deleted.
  Postgres note: the migration only ADDs the label (never uses it), so it applies inside Prisma's transaction.
- `backingServiceUnit(PER_LB) → ServiceUnit.LB` (LB already existed). New `isWeightPricingUnit()` so a PER_LB
  card backs a **WASHFOLD** rate `Service`, exactly like PER_KG.

### Where the conversion lives (ONE place)
`packages/shared`: `export const LB_PER_KG = 2.2046226218` + `kgToLb(kg)`.

Weight is **captured canonically in kilograms** (`WeightCapture.weightKg`, denormalized onto
`Item.measurements.weightKg` by `WeighService`). The only conversion site is `deriveMeasure`'s `LB` case:

```
weightLb ?? lb          → used as-is (back-compat: the existing LB linen lines)
weightKg ?? kg          → kgToLb(...)          ← the Inc-22 capture
weight                  → legacy ambiguous key, checked LAST
```
The kg capture is checked **before** the ambiguous `weight` key, so a kilogram load can never be mis-read as
pounds. A `PER_LB` line with no usable measurement returns `null` (no invented weight).

### UI
Console: `Per pound (lb)` unit option; the rate field label follows the unit (`Rate (CAD / lb)`).
Customer: Home footer `· per lb`; BookScreen asks `Approx. weight (lb)` — the line's `estimatedMeasure` is
always expressed in the **backing service's own unit** (the UI already renders `~{measure} {service.unit}`).

---

## 2) Icon picker — console and app cannot drift

`packages/shared` now owns the canonical list: `CATALOG_ICON_KEYS`, `CatalogIconKey`, `isCatalogIconKey`.

- Customer `HomeScreen.CATEGORY_ICONS` → `Record<CatalogIconKey, {Feather glyph, tint}>`
- Console `lib/catalog-icons.ts` → `Record<CatalogIconKey, LucideIcon>` + labels

Because both are **full** `Record<CatalogIconKey, …>`, adding a key in shared breaks BOTH typechecks until it
is mapped. **Proven, not asserted:** I temporarily added a `'drift-probe'` key — web `lib/catalog-icons.ts`
(both maps) and customer `HomeScreen.tsx` each failed `tsc` with TS2741. Probe reverted, shared rebuilt.

`<IconPicker>` (dropdown + live glyph preview) replaces the free-text "Icon key" input in **both** the
service-menu editor and the dry-clean category editor. **Persistence is unchanged** (still the icon-key
string). A legacy/unknown key is offered back as `"<key> (unsupported)"` so saving the form can never
silently wipe it — the founder sees it and picks a supported one.

Only the KEY is shared. Each surface keeps its own icon library (Feather in the app, lucide in the console).

---

## 3) Reorder → what the app actually renders

**`PATCH /v1/catalog/reorder`** (OWNER/FINANCE, org-scoped, audited `CATALOG_REORDERED`):
`{ scope: 'SERVICE_CARDS' | 'CATEGORIES' | 'ITEMS', ids: string[] }` → **renumbers `sortOrder` to the array
index (0..n-1) in one transaction.**

- **Renumber, not swap.** `createCategory`/`createItem` default to `sortOrder = 0`, so a pairwise neighbour
  swap would be a silent no-op on ties. Send the complete ordered list for the scope.
- Every id is verified to exist in the principal's org **and** in the named scope (a card can't be smuggled
  into an `ITEMS` reorder). A bad id rejects the **whole** call — no partial renumber.
- **Up/down arrows, not drag-and-drop.** A DnD library would add an npm dependency and root
  `package-lock.json` churn, which the pending EAS build is currently sensitive to. Arrows are
  keyboard-accessible, testable, and produce the same persisted result. (Swap to DnD later without touching
  the API — the endpoint takes a final order, not a gesture.)
- `DrycleanCatalogItemView += sortOrder` (additive) so the picker's item order is provable.
- `HomeScreen` and `DrycleanPicker` now render sorted by `sortOrder`, making the rendered order a **pure
  function of sortOrder** rather than of response order (the server already sorts; this closes the loop).

---

## Proof

| Suite | Before → After | Notes |
|---|---|---|
| api unit | **230 → 240** | new `derive-measure.spec.ts`: factor, LB←kg, explicit-lb precedence, kg-before-`weight`, null-when-absent, per-kg/item untouched, $19.84 / $21.00 / $18.00 |
| api e2e `weigh` | **7 → 8** | PER_LB: 6.00 kg captured → **$19.84** (13.2277… lb × $1.50, *not* 6 × 1.50); re-weigh 9 kg → **$29.76**; both kg captures retained |
| api e2e `catalog-dryclean` | **9 → 13** | reverse the cards → DB `sortOrder` 0..n-1 → **`GET /catalog/home` returns the flipped order**; ITEMS breaks the 0-tie; scope-mismatch → 400 nothing renumbered; dup ids → 400; dispatcher/driver → 403 |
| web | **141 → 148** | PER_LB option + `/ lb` label; picker offers exactly the shared keys; legacy key surfaced not wiped; save still PATCHes `{icon}`; move persists full order; edge arrows disabled; failure surfaced |
| customer | **105 → 108** | per-lb footer; Home renders in `sortOrder`; picker categories+items render in `sortOrder` — **both order tests feed a SCRAMBLED payload**, so they prove ordering, not arrival |

`tsc` clean: shared, api, web, customer. **No-stub sweep across all 24 changed files: ZERO hits.**

## Optional hardening — a FALSE ALARM (flagged, not "fixed")
`listServiceMenu` (`catalog-admin.service.ts` ~131) reads `where: { parentId: null }` with no explicit org
filter — but it runs through **`scopedPrisma`**, whose `buildReadScope(model, principal)` returns
`{ orgId: principal.orgId }` for *every* model unconditionally, and `findMany` is in `FILTER_WHERE_OPS`, so
the scope is **AND-merged** (`{ AND: [callerWhere, scope] }`) and a caller can never widen past the org.
Multi-tenant safety already holds. I added no redundant filter — a duplicate `orgId` there would imply the
other `scopedPrisma` reads need one too, which is false and would invite cargo-culting.

## ⚑ Honest notes
1. **Web jest is flaky under PARALLEL workers on this 8 GB machine.** `AdminHome` / `FacilityLinen` /
   `AccountDetail` time out with `act()` warnings and **the failing set changes between runs**. All 29 suites
   pass in isolation, and the full suite is **148/148 with `--runInBand`**. Pre-existing capacity flake that my
   29th suite tipped over; I touched none of those files. Use `npx jest --runInBand` in apps/web.
2. **`OrderWeightView.customerEstimate` sums `line.measure` across lines**, each in its own service unit — it
   already mixed kg + item counts + sqft before this increment. PER_LB adds one more unit to a pre-existing
   cross-unit sum. Not introduced here, not fixed here; worth a follow-up if the driver UI ever shows it for
   mixed orders.

## Next
- Founder: the console can now express per-lb rates. Entering a PER_LB rate creates a WASHFOLD backing
  service automatically; the plant still weighs in kg.
- Deploy: the migration is additive and the api auto-migrates on boot (`railway up --service api`), but
  **stash the EAS side-work first** — see `handoffs/2026-07-10-live-deploy-catalog-weight.md`.
- Optional: swap the arrows for drag-and-drop later; the reorder endpoint already takes a final order.
