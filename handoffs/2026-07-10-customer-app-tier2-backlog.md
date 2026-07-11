# Customer app — Tier-2 build backlog (step by step)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **App:** `apps/customer`
**From:** planning/QC chat · **For:** Claude Code (executes one step at a time).
**Rule:** each step is a vertical slice — **API endpoint(s) → customer screen → tests/verify** — no stubs; `org_id` on every row + server-side row-scoping; TS strict; lifecycle/enums per PRD; log to `CHANGELOG.md` + a dated handoff per step.

## Baseline confirmed in code (do NOT rebuild)
- **Order history + detail: complete.** `OrdersScreen` (skeleton/error/refresh/empty + per-order cards) → `OrderDetailScreen` (quote approve/decline, before/after photos, live weigh→price card, status timeline, chat).
- **Profile: shell only.** `SettingsScreen` = identity (name/phone/avatar) + Sign out + Corporate join-code/memberships + two-step Delete Account. **No** editable profile, addresses, saved cards, or notification prefs — those are Tier-2 below.
- Tier-1 (Google Maps Android key, Stripe `pk_test`) is PARKED per founder — not in this backlog.

## Proposed order (execute one at a time; founder may reorder)
1. **Addresses** — add/manage/pick. ✅ **DONE + LIVE** (Inc-26, Nominatim geocoder, three-state serviceability).
   - *(inserted)* **Console customer-360** — ✅ **DONE + LIVE** (Inc-27: `/admin/customers` + `/customers` console view; seed UUID collision fixed). Console-side, not a customer-app item.
2. **Pickup scheduling** — ✅ **DONE** (Inc-28: availability endpoint + customer picker + Admin→Scheduling control + the inherit-on-create fix that made the window actually reach RouteStop/optimizer/analytics). Independently code-audited. **Not yet deployed** (`railway up` + EAS rebuild pending). Founder sets real hours in Admin→Scheduling; default ships visibly labelled until then.

### Known bug found during Inc-28 (not yet fixed — its own increment)
- **Order item ordering is nondeterministic.** `ORDER_INCLUDE.items` (`orders.service.ts:56`) has no `orderBy` and `Item` (`schema.prisma:797`) has no ordinal column → Postgres heap order + a shared txn timestamp means two reads can list an order's items differently, on every surface, and it can **misprice** (a rug's sqft landing on a garment — caught by CC's own test). Fix = add an ordinal/position column to `Item` + backfill existing rows. Recommend doing this before more Tier-2 features.
3. **Ratings / post-delivery CSAT.** PRD A6.3 [MVP].
4. **Claims / exceptions** (missing/damaged, with photos). PRD A6.2 [MVP].
5. **Notification preferences / quiet hours.** PRD A6.1 [MVP] + §8.5.
6. **Saved payment methods** (Stripe SetupIntent + default card). PRD A1.2. (Pairs with the Tier-1 Stripe key.)
7. **Social / email login** (Apple/Google/email alongside phone-OTP). PRD A1.1.
8. **Reschedule / cancel an order** + **tip at pay** (PRD A5.1). Smaller; last.

Steps 2–8 get their own brief when we reach them.

---

## STEP 1 — Saved addresses (add · manage · pick)  — CC executes now

**Why first:** `apps/customer/src/api/customer-client.ts:48` has only `getSites()` (GET `/sites`, read-only). Book only lets a user pick a *pre-existing* site, and the address card renders `if (sites.length > 0)` — a new customer with no site has no way to add one and booking would proceed without a `siteId`. This is the onboarding blocker.

**Backend (build the missing write side):**
- Confirm the `Site` model + what serves customer `GET /sites` (likely a sites/accounts controller). 
- Add customer-scoped, org-scoped, idempotency-keyed endpoints: **`POST /v1/sites`** (create), **`PATCH /v1/sites/:id`** (edit), **`POST /v1/sites/:id:deactivate`** (soft delete — a past order may reference the site, so deactivate, don't hard-delete). Fields: label (Home/Work/free), address lines, unit/buzzer/notes, and a **PostGIS point**.
- **Geocoding:** resolve address → lat/lng server-side via Google Maps Platform (already the stack's maps/geo provider) and write the PostGIS `geo` (mirror how seeded sites set geo via raw SQL). No fabricated coordinates. If the app supplies a map-picked lat/lng, accept it; otherwise geocode the typed address.
- **Serviceability:** the `service-zones` module already exists — check the new address against coverage and return a `serviceable` boolean (+ a `coverage-request` path if outside, which also already exists) so the app can say "we serve your area" before booking. PRD A1.2.
- Row-scope: a customer can only create/read/edit sites on their own account(s); cross-account → 403.

**Customer UI:**
- `customer-client.ts`: add `createSite` / `updateSite` / `deactivateSite`.
- **BookScreen:** when `sites.length === 0`, show an **"Add address"** CTA (not a hidden card); an add-address form (typed address + unit/buzzer + label; optional map-pin confirm). On success, refresh the list and pre-select the new site. Block submit until a `siteId` exists.
- **Profile (SettingsScreen):** an **"Addresses"** section — list, add, edit, remove, set default.
- Surface the serviceability result inline (serviceable → proceed; out-of-area → the existing calm out-of-area state / coverage-request).

**Honesty firewall:** no fake geo, no "serviceable" unless the zone check says so.

**Verify (the proof):** as a customer with 0 sites → add an address → it geocodes to a real point → appears in the Book picker → a booking succeeds carrying the new `siteId`; edit + deactivate work; another customer gets **403** on that site; out-of-area address surfaces the coverage state; api `tsc` + new unit/e2e (create/list/edit/scope-403/serviceability) green; customer `tsc` + screen tests green.

**Deploy:** API via `railway up` (the EAS enablement set is now committed in sync, so no stash/pop dance). The screen reaches phones on the next EAS build — batch it with later steps rather than a build per step.
