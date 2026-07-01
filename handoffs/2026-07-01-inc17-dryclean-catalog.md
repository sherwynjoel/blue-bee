# Handoff — Inc-17 · Visual dry-clean item catalog (categorized, with images)

**When:** 2026-07-01 14:28 IST · **Branch:** `feature/dryclean-catalog-inc17` off `main` (`aa204ee`) · **Single CC session.**
**Status:** built + verified locally; **NOT merged** — the founder lands it (ff) + redeploys Railway. No `main` merge, no force-push, foundation `7d1fa47` untouched.

## What shipped
A **categorized** visual dry-clean catalog (Shirts / Outerwear / Formalwear …), seeded now with **SAMPLE** items + images, populated for real later by the founder via the admin screen. Built against **PRD "Cascade"** (specialty dry-clean catalog) + **§9.2 pricing**. Reuses every existing seam — **catalog items ARE `Service` rows** (`unit = ITEM`), so the quote engine + `PriceListItem` per-account overrides work unchanged; **photos go through the existing presigned media seam** (stored as `Service.imageKey`, signed on read); **per-account overrides are the Inc-15 rate-card editor** (`/corporate`), unchanged — these items appear there automatically.

## Key design (reuse, don't reinvent)
- **Catalog item = `Service` (unit ITEM)** + a nullable `categoryId` FK → new `ServiceCategory`, a nullable `imageKey` (the media storageKey — NOT a new URL column), and `active`/`sortOrder`. All additive/defaulted ⇒ every existing Service is untouched.
- **Image path reuses `MediaService`** — added `presignCatalogImage` + `confirmCatalogImage` (org-scoped, owner/finance, no order), mirroring how the driver POD added a stop-scoped path. Same allow-list + size cap + unguessable org key + PENDING→CONFIRMED intent + HEAD-verify. The image lands in the SAME MinIO bucket via the SAME AWS-SDK S3 path; `MediaSigner` signs `Service.imageKey` on read. **No second media path.**
- **Customer price is server-resolved** — `GET /v1/catalog/dryclean` resolves each item's price via `PricingService.resolveRate` on the effective pricing account (`Order.pricingAccountId` semantics: an active corporate membership → that account, else the caller's own account → base). The app renders it; it never prices anything (the Inc-16 rule).
- **Per-account overrides are NOT re-implemented** — the Inc-15 `/corporate` rate-card editor already lists every service, so these new items get overrides there. An e2e proves an override set that way flows to the customer picker.

## Migration
`apps/api/prisma/migrations/20260701010000_dryclean_catalog_inc17/migration.sql` — **additive only** (`PhotoKind` +`CATALOG`; `Service` +`active`/`category_id`/`image_key`/`sort_order`; new `ServiceCategory`; 2 indexes + one SET-NULL FK). **Migration count is now 16.** (As with Inc-15, the two phantom `DROP INDEX` lines a `migrate diff` emits for `ParLevel_/LinenStock_…` — migration-14's raw `NULLS NOT DISTINCT` indexes — are deliberately OMITTED; the linen `ON CONFLICT` depends on them.) Prisma client regenerated. Fresh-DB `migrate deploy` applies all 16 clean; **10 pre-existing services stay untouched** (`category_id` NULL, `active` true, wash&fold LB intact).

## Files
- **API:** `catalog/catalog-admin.service.ts` + `catalog-admin.controller.ts` (new — categories + items CRUD + image presign, OWNER/FINANCE); `catalog/catalog.service.ts` + `catalog.controller.ts` (customer `GET /catalog/dryclean`); `catalog/catalog.module.ts` (imports OrdersModule + MediaModule); `media/media.service.ts` (+presign/confirm catalog image); `orders/orders.service.ts` (unchanged this inc — Inc-16); `prisma/{schema.prisma, seed.ts, seed-catalog.ts (new), migrations/20260701010000_dryclean_catalog_inc17/}`.
- **Shared:** `catalog.ts` (categories/items/admin/dryclean DTOs + views), `enums.ts` (`PhotoKind.CATALOG`).
- **Web:** `components/CatalogAdmin.tsx` (new — `/catalog` admin), `app/(console)/catalog/page.tsx` (new), `lib/{api-client,media,rbac}.ts`, `components/AppShell.tsx` (nav). (Also `CorporateAccounts.test.tsx` — a one-char `!` fixing a pre-existing `noUncheckedIndexedAccess` latent error my full `tsc` surfaced.)
- **Customer:** `components/DrycleanPicker.tsx` (new — grouped visual picker), `screens/BookScreen.tsx` (renders the picker; adds ITEM line items through the EXISTING draft-item → `buildBookDto` path — no parallel cart), `api/customer-client.ts` (`getDrycleanCatalog`).

## Seed (SAMPLE — founder overwrites via /catalog admin)
`seedDrycleanCatalog` — **3 categories** (Shirts, Outerwear, Formalwear) + **7 sample items**; each item's photo is a **genuine PNG generated + PUT into MinIO** through the same AWS-SDK S3 path (no hard-coded URLs, no `placeholder.png` literals), recorded as a CONFIRMED `MediaUpload` + referenced by `Service.imageKey`. **Prices + the solid-colour tile images are obviously-SAMPLE** — the founder replaces them (upload a real photo + set the real price) via `/catalog`.

## Tests — exact new titles + counts (read + counted, not estimated)
**NEW API e2e — `apps/api/test/catalog-dryclean.e2e-spec.ts` (9):**
1. FINANCE creates a category (audited); dispatcher/driver/member cannot (403)
2. FINANCE renames + reorders a category; a cross-org owner cannot see or patch it
3. presign → PUT real PNG bytes to MinIO → create the item; its signed imageUrl serves the SAME bytes
4. creating an item with an UNVERIFIED image key is rejected (404) and the item is never persisted
5. edits the item; a non-ITEM (wash&fold LB) service → 400; a member cannot edit (403)
6. a plain resident sees the catalog grouped, with the BASE price + the photo
7. a corporate member (override via the existing rate-card editor) sees the OVERRIDE price; a resident still sees BASE
8. a deactivated item drops out of the customer picker
9. a resident books an order with the catalog item serviceId (a real ITEM line item, base rate)

**NEW web component — `apps/web/components/CatalogAdmin.test.tsx` (6):**
1. renders categories with their items — photo + name + base price
2. FINANCE creates a category (calls the API with the typed name)
3. FINANCE adds an item to a category (name + price, no photo) via the real order/pricing path
4. adds an item WITH a photo — uploads through the media seam, then creates with the storageKey
5. editing an item price calls updateCatalogItem
6. RBAC (UX): a non-catalog role gets a no-access notice and never fetches the catalog

**NEW customer component — `apps/customer/src/components/DrycleanPicker.test.tsx` (5):**
1. renders categories → items with photo + name + (server-resolved) price
2. tapping + adds one unit (feeds the existing draft-item list — no parallel cart)
3. shows the quantity + a − control once an item is selected, and − removes one
4. shows the corporate-pricing note when the server resolved a corporate account
5. renders nothing when there are no categories (degrades cleanly)

**+1 case added to `apps/customer/src/screens/BookScreen.test.tsx`:** "renders the dry-clean visual picker when the catalog loads, and tapping + stages an ITEM line for booking".

**Totals (before → after):** API e2e **264 → 273** (+9); web jest **122 → 128** (+6); customer jest **85 → 91** (+6 = DrycleanPicker 5 + BookScreen 1). **21 new tests.**

## Evidence
- **Migration:** applied 14→…→**16**; fresh-DB `migrate deploy` (all 16) clean; existing services untouched (query: 10 uncategorized, wash&fold LB intact).
- **API:** typecheck clean; **full e2e 273/273, 26 suites** (incl. NEW catalog 9/9 + the Inc-11 catalog 6/6; NO regression). `/v1/health` **200** (postgis/timescaledb/redis up).
- **Web:** typecheck + `next lint` clean; **jest 128/128, 26 suites** (NEW CatalogAdmin 6/6); **`next build` green** (route `/catalog`).
- **Customer:** typecheck + `eslint` clean; **jest 91/91, 15 suites** (NEW DrycleanPicker 5/5 + BookScreen picker case); **`expo export` (ios) bundles** (Hermes `index-*.hbc` 3.05 MB).
- **Seed:** `3 categories + 7 sample items; 7 real PNGs uploaded to MinIO`. A direct HEAD+GET on a seeded key returned `image/png` 179 B with a valid PNG signature.

## No-stub sweep (pasted)
```
grep -rniE "\b(stub|mock|fake|placeholder)\b|TODO|FIXME" <shipped non-test paths> \
  | grep -viE "placeholder=|comment lines"
→ CLEAN. The only hits are in seed-catalog.ts DOC COMMENTS that literally state the seed uses
  "genuine PNGs … not a placeholder string" (describing the ABSENCE of placeholders). Real DB writes,
  real MinIO uploads (presign→PUT→confirm), real resolveRate pricing — no mocked layers in shipped paths.
```

## 6-lens adversarial QC (refute-by-default — all survived)
1. **Additive & reversible-safe** — fresh DB: 10 pre-existing services keep `category_id` NULL / `active` true; wash&fold LB intact. Migration is ADD-only, no DROP, no NOT-NULL-without-default. ✓
2. **Image genuinely in MinIO + serves back** — e2e presign→PUT→confirm→signed GET returns byte-identical bytes; seed HEAD+GET confirmed a real PNG. ✓
3. **Per-account override changes the customer price** — e2e: member sees **$4.00 (account_list)**, not $6.00. ✓
4. **Base price when no corporate applies** — e2e: plain resident sees **$6.00 (service_base)**, `pricingAccountName` null. ✓
5. **Nullable category didn't break existing ITEM/LB** — full e2e 273/273 no regression; fresh-DB query shows existing services unchanged. ✓
6. **Picker line items flow through the real order path + quote** — e2e books the catalog `serviceId` → REQUESTED, line rate = base $6; it's a real bookable `Service` (unit ITEM). ✓

## Deferred (unchanged from the prompt's Scope OUT)
Live AWS S3 (founder-gated; proven on MinIO); populating real items/photos (founder, via `/catalog`); drag-drop item reordering (a `sortOrder` field + basic control is enough); wash&fold LB (untouched); the customer-app EAS build (web admin reaches the pilot on the next web/api redeploy; the app picker rides a later EAS build).

## Next
The founder lands `feature/dryclean-catalog-inc17` (ff into `main`) + redeploys Railway, then populates real dry-clean items/photos/prices via `/catalog`.
