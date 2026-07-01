# Inc-19 — Geo-blocking (drawn service zones · block-at-booking · demand capture)

**Branch:** `feature/geo-blocking-inc19` off `main` (`1255fbd`, the landed Inc-18 tip).
**Feature commit:** `011f748` (+ this bookkeeping commit).
**Single CC session.** Pushed to `origin/feature/geo-blocking-inc19`. **NOT merged — founder lands it (ff) + redeploys.** `7d1fa47` untouched; no force-push.

---

## What shipped

Owner/finance **draw polygon service zones on the map**; at booking, a service point that falls in **NO active zone** is **blocked (HTTP 422 `zone.out_of_service_area`)** and its address is **captured as a `CoverageRequest`** (the coverage waitlist). A serviced **corporate order is never blocked** (building match OR active membership OR a corporate payer account). The **server is authoritative** — the app never decides serviceability.

### The gate policy (preserves all existing behaviour)
The zone gate fires only when **all** of: the order is **not** corporate (`resolveForBooking` returned non-null OR `account.corporate`) · a **service point is supplied** (`dto.serviceGeo`; mirrors the building-match `if (serviceGeo)`) · the org has **≥ 1 ACTIVE zone**. Otherwise it books. This is why the whole existing suite stays green — 26/27 existing specs book without `serviceGeo`, and the one that sends it (corporate-pricing) runs against an org with **zero active zones** (see the seed note).

### Reuse (Step-0, no reinvention)
- **Raw-PostGIS-through-Prisma** pattern from `PricingAccountService.matchBuilding` (Inc-15): `$queryRaw`/`$executeRaw` + `ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography`, org-scoped `::uuid` casts, snake_case result keys. Zones use `ST_Covers` (boundary-inclusive) on `geography`; the polygon is written from GeoJSON via `ST_GeomFromGeoJSON` and read back via `ST_AsGeoJSON` (the round-trip). Column is Prisma `Unsupported` like `Site.geo`.
- **Corporate override** = `PricingAccountService.resolveForBooking` (already computed in `book` before order creation) — `effective != null` (building match or membership) → bypass. Extended with `account.corporate` to also bypass a corporate account booking for itself (the self-match case where `resolveForBooking` returns null because the match equals the payer).
- **RBAC**: `@Roles(RoleType.OWNER, RoleType.FINANCE)` + the global `JwtAuthGuard→RolesGuard`; org scoping via explicit `org_id = ${orgId}::uuid` on every raw query (a new org-only model needs no `scopedPrisma` entry). Cross-org → 404 (scoped miss), mirroring the corporate helper.
- **Idempotency** (`@UseInterceptors(IdempotencyInterceptor)`), **cursor pagination**, **problem+json** (`error` → `title`) — all per §11 / the as-built conventions.
- **Booking service point** = the existing optional `serviceGeo` on `bookOrderSchema` (Inc-15); no new geocode.

### ⚠️ Maps deviation (Step-0 assumption was WRONG — documented, not stubbed)
The prompt assumed a **Google Maps** seam. **There is no Google Maps anywhere in the repo.** The web map seam (`FleetMap`) is **Leaflet + react-leaflet + OpenStreetMap tiles — no API key**, dynamically imported `ssr:false`. Per the prompt's own rule ("reuse the existing map + key seam · no second maps integration · never stub the map; if genuinely blocked, STOP"), the **faithful** path was to build **real polygon drawing on the existing Leaflet seam** — not to bolt on a second maps SDK. So `ZoneEditorMap` is a Leaflet click-to-add-vertex editor (finish/undo/clear, live polygon preview, renders existing zones). **No credentials were needed and nothing is stubbed.** (A future Google adapter stays a drop-in replacement for this component, exactly as the FleetMap comment already anticipates.)

---

## Schema + migration

**Migration `20260701190000_geo_blocking_inc19` → 18 migrations** (was 17). Additive only, no DROP, no data touched.
- `ServiceZone` (org-scoped): `id, org_id, name, active(default true), sort_order, area geography(Polygon,4326), created_at/updated_at/created_by` + `org_id` index + a hand-authored **GiST index** `ServiceZone_area_gist` for the `ST_Covers` check.
- `CoverageRequest` (org-scoped): `id, org_id, user_id, address, point geography(Point,4326), context jsonb, created_at/updated_at/created_by` + indexes on `org_id`, `user_id`, `(org_id, created_at)`.
- The phantom `DROP INDEX "ParLevel_/LinenStock_site_cost_center_service_key"` lines a `migrate diff` emits are **deliberately OMITTED** (migration-14 raw `NULLS NOT DISTINCT` indexes the linen upsert depends on) — verified still present after apply.

**Existing data intact** (post-apply query): 1068 Orders / 15 Sites / 26 Users unchanged; both geography columns + the GiST index present; the two phantom indexes present.

---

## Files touched

- **shared**: `packages/shared/src/zones.ts` (new — GeoJSON polygon zod, zone/coverage DTOs+views, `ZONE_ERRORS`), `catalog.ts` (`CustomerSite.geo`), `index.ts`; `packages/api-client/src/problem.ts` (`ApiError.isOutOfServiceArea`).
- **api**: `src/service-zones/*` (new — service + 2 controllers + module), `orders/orders.service.ts` (the gate) + `orders.module.ts`, `catalog/catalog.service.ts` (surfaces `Site.geo`), `app.module.ts`; `prisma/{schema.prisma, seed.ts, migrations/20260701190000_geo_blocking_inc19/*}`; `test/geo-blocking.e2e-spec.ts` (new).
- **web**: `components/{ServiceZones.tsx, ServiceZones.test.tsx, ZoneEditorMap.tsx (all new), AppShell.tsx}`, `app/(console)/service-zones/page.tsx` (new), `lib/{api-client.ts, rbac.ts}`.
- **customer**: `src/orders/booking.ts` (send `serviceGeo`), `src/screens/{BookScreen.tsx, BookScreen.test.tsx}` (calm out-of-area state).

---

## Tests — exact titles + counts (counted, not estimated)

**Before → after: API e2e 280 → 298 (+18) · web 128 → 137 (+9) · customer 96 → 98 (+2). Total +29.** All suites green.

### API e2e — `apps/api/test/geo-blocking.e2e-spec.ts` (+18)
1. RBAC: dispatcher / driver / a residential customer cannot create a zone (403)
2. OWNER draws a zone; it lists back and the GeoJSON round-trips (geometry → GeoJSON)
3. FINANCE can create a 2nd zone and patch it (rename / reorder / activate)
4. a malformed polygon is rejected: too few points → 400; self-intersecting → 400
5. cross-org: an org-2 owner cannot read or patch an org-1 zone (404, never leaks existence)
6. a booking INSIDE an active zone books (201)
7. a booking in the SECOND active zone books (multi-zone, 201)
8. boundary: a point just inside books; a point just outside is blocked (ST_Covers, sane boundary)
9. a booking OUTSIDE every active zone is blocked (422 out_of_service_area) and captures ONE CoverageRequest
10. demand-capture is honest: a repeated blocked attempt at the same point does NOT duplicate (lens 5)
11. a deactivated zone stops covering — a previously-inside point is now blocked (422)
12. no active zones ⇒ the org serves everywhere (gate inert)
13. a booking with NO service point is not gated (nothing to test — mirrors building-match)
14. an in-building resident books at a point outside every public zone (building match bypasses)
15. an active member books at a point outside every zone and outside every building (membership bypasses)
16. a corporate ACCOUNT booking for itself is never geo-blocked even outside every zone
17. OWNER/FINANCE read the coverage waitlist (cursor-paginated); a customer cannot (403)
18. org-A's zones never gate org-B — an org-2 booking at a point outside org-1's zones books (201)

### Web — `apps/web/components/ServiceZones.test.tsx` (+9)
draftToPolygon: (1) closes an open ring into a valid GeoJSON Polygon · (2) leaves an already-closed ring closed · (3) rejects a degenerate draft (<3 points). Board: (4) renders zones with active/off + the coverage waitlist · (5) deactivate → updateZone({active:false}) · (6) activate → updateZone({active:true}) · (7) rename → updateZone({name}) · (8) reorder → two sort_order patches · (9) a non-owner/finance sees the no-access gate.

### Customer — `apps/customer/src/screens/BookScreen.test.tsx` (+2)
(1) sends the selected site's `serviceGeo` so the SERVER can geo-block (app never decides) · (2) renders a CALM out-of-area state (not the red error) on a 422, surfacing the captured address.

**Full runs:** API e2e **298/298 (28 suites)** — re-confirmed WITH the inactive seed zones present. Web **137/137 (27 suites)**. Customer **98/98 (16 suites)**. api/web/customer **typecheck clean**.

---

## No-stub sweep (pasted)

```
grep -rniE 'TODO|FIXME|\bstub\b|\bmock\b|placeholder|\bfake\b' <shipped Inc-19 paths> \
  | grep -vE '\.(test|spec)\.' | grep -vE 'placeholder(=|Text)'
→ ✓ CLEAN — no stub/mock/placeholder/TODO/FIXME/fake in shipped non-test paths
```
(The only two initial hits were a comment using "fake" in prose about *not* faking — reworded — and a pre-existing RN `placeholderTextColor=` attribute, the analog of the excepted HTML `placeholder=`.)

---

## 6-lens adversarial QC (refute-by-default — proven, not asserted)

1. **Enforcement is server-side** — REFUTED "a client can skip the check": the block lives in `OrdersService.book` and returns 422 regardless of any client hint; e2e #9 (outside → 422) + #8 (just-outside → 422) + #13 (the "hint" is the client pre-check, not `serviceGeo`; the app always sends the point, the server always enforces). HOLDS.
2. **Corporate override** — REFUTED "corporate gets blocked": e2e #14 (in-building resident books outside every public zone, priced on the corporate account), #15 (active member books outside every zone/building), #16 (corporate account books for itself). All 201. HOLDS. Decision recorded below.
3. **Geometry correctness** — REFUTED "boundary is wrong / winding flips inside-out": e2e #8 (just-inside 201 vs just-outside 422, `ST_Covers` boundary-inclusive), #6/#7 (real drawn boxes), #2 (GeoJSON round-trips through geography and back). **Live catch:** an initial IN_A point sat inside the seeded demo corporate building (~120 m from Maple District Tower 1, 300 m radius) → the override correctly masked the zone check; relocated the zone-test points ≥ 7 km from every corporate building so the tests exercise the ZONE, not a bypass — the correct-override behaviour is itself proven by #14. HOLDS.
4. **Tenancy** — REFUTED "org-A zones gate org-B / CRUD leaks cross-org": e2e #5 (org-2 owner GET/PATCH an org-1 zone → 404), #18 (an org-2 booking outside org-1's zones books — org-1 zones never gate org-2). Every zone/coverage read+write is org-scoped by explicit `org_id = ${orgId}::uuid`. HOLDS.
5. **Demand-capture honesty** — REFUTED "orphan/duplicate rows / app claims listed on a failed write": e2e #9 (exactly ONE CoverageRequest per blocked booking, address + point captured, no order row created), #10 (a repeated blocked attempt at the same point does NOT duplicate — dedup within a recent window). The capture commits BEFORE the 422 is thrown, so a failed write means no 422 + no row; the customer app only surfaces what the 422 confirms (no invented "you're on the list" promise). HOLDS.
6. **No lifecycle/pricing corruption** — REFUTED "the gate mutates status or rates": the gate runs BEFORE the order transaction and only throws or falls through — it never creates an order, never transitions status, never touches pricing. The full existing e2e (280) stays green (298 total), including `corporate-pricing` and `orders`. HOLDS.

---

## Decisions the founder should know

- **Corporate-override rule = `resolveForBooking() != null` OR `account.corporate`.** A building match or active membership bypasses the block (the explicit cases). The `account.corporate` clause additionally covers a corporate account booking under itself (where `resolveForBooking` returns null because the matched account equals the payer). Proven by e2e #14–#16.
- **Sample zones are seeded INACTIVE (drafts).** Real polygons (downtown Toronto + North York, `ST_Polygon`, 7 & 21 km²) but `active=false` ON PURPOSE: active zones would gate the shared demo org's existing bookings + the whole e2e suite (a point outside every active zone is blocked). **The founder reviews, redraws, and ACTIVATES them in the `/service-zones` console to turn on block-at-booking.** The active-zone gate itself is proven end-to-end by the e2e (which creates + tears down its own active zones). These are SAMPLE zones to redraw.
- **Auto-notify is DEFERRED (Scope OUT).** A waitlisted address is captured only; when a new zone later covers it, nothing is sent. The hook is modeled (the `CoverageRequest` rows + the console waitlist) — the notify send is **not faked**. Notification providers stay parked.
- **Also deferred (Scope OUT):** per-zone pricing / scheduling windows / capacity; driver-routing changes; signup-time blocking (block-at-booking only); polygon/KML import (drawing only).

---

## Definition of Done — evidence

- ✅ Migration `20260701190000_geo_blocking_inc19` shown; count **18**; existing data intact (1068 orders / 15 sites / 26 users; phantom indexes retained).
- ✅ API: inside-books, outside-blocked-with-CoverageRequest, corporate-override-books (×3), RBAC 403/404, malformed-polygon 400, deactivated-zone-stops-covering — all e2e-proven (298/298).
- ✅ Web: the zone editor draws + persists a real polygon (GeoJSON → geography → GeoJSON round-trip proven by e2e #2 + the `draftToPolygon` unit tests); the coverage-requests view renders (web #4). On-device draw = the founder's run.
- ✅ Customer app: the out-of-area state renders and is server-driven (customer #2, asserting the 422 branch + captured address). On-device = the founder's run.
- ✅ Full e2e + web + customer suites green (298 / 137 / 98). New test titles listed + counted above.
- ✅ No-stub sweep pasted (clean); 6-lens writeup above.

**Next (per the plan): after geo-blocking, the MAKE-IT-REAL track — S3 first.**
