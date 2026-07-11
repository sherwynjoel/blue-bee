# Blue Bee — MVP status + the two briefs to finish it (collapse → EAS)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Branch:** `feature/s3-media-golive`
**From:** planning/QC chat · **For:** Claude Code (executes) + founder (decisions/manual steps)
**Live:** api `https://api-production-d45a.up.railway.app` · console `https://web-production-ba508.up.railway.app`
**Canonical login (founder decision 2026-07-10):** `+14165550001` "Demo Owner" → org `11111111-1111-4111-8111-111111111111`. Log in with THIS number (not `+14165550100`).

---

## PART 1 — MVP status snapshot

**Phase: tail end of Phase 1 (MVP). Code-complete; already built into Phase 2.** Every one of BUILD-PLAN's 13 Phase-1 items exists as real, tested, committed code.

**On disk / live:**
- **API (NestJS) — 36 controllers:** auth (OTP+JWT+RBAC), orders + quote lifecycle, catalog + catalog-admin, weight→price, driver, logistics (routes/stops/fleet), tracking (locations/fleet-live/order-tracking gateway), payments (Stripe + webhook), media (photos), notifications, analytics, admin, chat. Phase-2 already present: residents, facility-linen, cost-centers, corporate, standing-orders, invoices, portal.
- **Customer app (Expo):** Login, Home, Book, Orders, OrderDetail, Track, Pay, Chat, Settings.
- **Driver app (Expo):** Login, Home, Route, Stop, POD, Weigh, Chat, Settings (offline-first, queue proven).
- **Owner app (Expo):** Login, Dashboard, Fleet map, Exceptions, Approvals, OrderDetail, RouteDetail, Settings.
- **Web console (Next.js) — 19 pages:** orders board, dispatch, fleet, catalog & pricing, finance, analytics, accounts, residents, corporate, service-zones, facility-linen, admin, portal.

**Exit criteria** ("book → track → custody → deliver → bill with live tracking, **on real iOS + Android devices**"):
- book → bill + live tracking: **built + proven** (full-chain e2e green, Inc-23) and **live** on API + web.
- The only unmet clause: **"on real devices"** — the 3 Expo apps run in simulator but haven't shipped an **EAS build** to a physical phone. That is Part 3 below. → **~95% of Phase 1.**

**Demoable today, zero new work:** the live web console + API (log in `+14165550001`, 8-card catalog is there).
**For a priced demo:** all 8 cards are `priceFrom: NULL` ("Get a quote") until the founder enters real CAD rates in `/catalog`.
**For a phone demo:** needs the EAS build (Part 3).

**Known non-blocking debt (flagged, not fixed):** `OrderWeightView.customerEstimate` sums `line.measure` across mixed units (kg + item count + sqft + lb) → meaningless on a customer-facing estimate; jest parallel-worker isolation flake (passes `--runInBand`); Inc-25 seed/UI fixes built but **not deployed** (live still runs Inc-24).

---

## PART 2 — BRIEF: collapse to one org  ⚠️ DESTRUCTIVE — CC executes, founder authorises

**Goal:** exactly one `Organization` row. Keep `11111111` (canonical). **Purge** the two others found in the Inc-25 audit:
- `71a08dfc-8f17-4ad5-b47b-10d3f0051392` — "Pilot Owner" (`+14165550100`) + the hand-made `Wash & Fold` category + attached `Garments` Service. Purging the org removes that residue automatically — no separate residue step.
- `e0000000-…-002` — "Demo Org 2 (isolation test)". Audit its contents first; expected near-empty.

**Do NOT touch `11111111`.** It holds 15 users incl. the `+14165550001` login and the customer test login `+14165550111` "Grace", plus 21 orders, 8 quotes, 3 invoices, 1 payment, 67 custody events, 20 tags, 13 sites. Deleting it would destroy the very login the verify step uses.

> **Correction (post-collapse, CC 2026-07-10):** "Andre" `+14165550101` does **not** exist and never did (not at risk from the purge). The real driver demo login is **`+14165550006` "Demo Driver"**. There are **zero Driver / fleet rows** — the fleet table is empty, so the driver app's route list is empty until routes+stops are seeded (see Part 4). Confirm the exact live login list from the DB before the demo.

**Guardrails (non-negotiable):**
1. **Back up first.** `pg_dump`/`psql` are unusable here (private DB; api image ships neither). Use the full logical dump (every public table via `row_to_json`, which also captures the PostGIS `Site.geo` a Prisma export drops; whole DB ≈ 25 MB / ~386 real rows). **Founder reviews the dump before any delete.** No backup → no delete.
2. **Target only the two doomed org IDs.** Never `11111111`.
3. **Per-table, FK-ordered deletes.** `org_id` has **no FK** to `Organization` (0 of 85 FKs reference it) — `DELETE FROM "Organization"` cascades nothing and orphans ~302 rows. Delete child→parent in FK order.
4. **Disable append-only triggers inside the transaction**, re-enable after: `AuditLog`, `CustodyEvent`, `WeightCapture`, `LinenMovement`, `ProcessedStripeEvent`. A naive purge dies partway otherwise.
5. **One transaction.** Verify **`SELECT count(*) FROM "Organization"` = 1** before commit.
6. **This is NOT a `railway up`.** It's a DB operation. Do not deploy the working tree to run it.

**Verify (proof):** log in `+14165550001` → token `org_id == 11111111` → `GET /v1/catalog/service-menu` = 8 cards, all `priceFrom` null → Grace (`+14165550111`) + Demo Driver (`+14165550006`) logins still resolve → `Organization` count = 1. ✅ **DONE 2026-07-10** (backup `bluebee-pre-collapse-20260710T152711.json.gz`, 392 rows, sha256 `16ffec3e…`; `+14165550100` + `+14165559001` now 401).

**After collapse:** `+14165550100` (Pilot Owner) login stops working — use `+14165550001` only.

**Boundary:** permanent deletion of production users/orders/a payment row, and handling the DB credentials, stays with CC/founder. The planning chat does not execute this and does not route around the sandbox's credential/dump denials.

---

## PART 3 — BRIEF: EAS build (the last exit-criteria item)

**Goal:** standalone **`preview` APKs** (JS baked, no Metro tether) for **Driver + Customer** (then Owner) on a physical **Android**, talking to the live Railway API. This is how the driver Weigh screen + customer live "Weighed X kg → $Y" line (Inc-23) finally reach a phone.

**The blocker = lockfile sync.** The 2026-07-09 EAS enablement fixes are on disk but **NOT committed** (the ~18-entry uncommitted working tree). `npm ci` fails whenever `package.json` and `package-lock.json` are out of sync. So:

**Step 0 — commit the EAS enablement set, in sync.** One commit containing exactly (per the 2026-07-09 handoff §"Commit these"):
`package.json` (root: `overrides.expo-font` = `12.0.10` + the `postinstall` that builds `@blue-bee/shared` + `@blue-bee/api-client`), `package-lock.json` (regenerate via `npm install` so it matches; then confirm **`npm ci` passes clean**), `apps/driver/app.json`, `apps/customer/app.json`, `apps/driver/eas.json`, `apps/customer/eas.json`, both `plugins/withSplashscreenBackgroundColor.js`, and the added deps (`expo-dev-client`, `expo-updates`, `expo-splash-screen`) in both app `package.json`. **Committing this in sync also retires the stash/pop dance** future `railway up` deploys needed.

**Step 1 — per app (driver, then customer):**
- `nvm use 20` first (new shells default to Node 24, which breaks SDK 51 / RN 0.74).
- `rm -rf android ios` (a leftover `android/` makes EAS detect a BARE workflow → `runtimeVersion {policy: appVersion}` unsupported → upload error).
- Verify locally BEFORE the ~1 hr cloud queue: `npx expo prebuild -p android --no-install` (colors.xml has `splashscreen_background`) + `npx expo export -p android` (bundles clean: driver ~1058, customer ~1104 modules).
- `eas build -p android --profile preview`. The `preview` profile bakes `EXPO_PUBLIC_API_BASE_URL = https://api-production-d45a.up.railway.app`.
- EAS project IDs: driver `32b3f490-99a7-4faf-87d9-d6ecb24f9d28` · customer `862c2326-8f90-45b6-a49b-e5f12b15c540`. Expo account `gautam1337`.

**Step 2 — install + verify on the phone:** download APK per app → allow unknown sources → open → login (phone OTP) → customer book/orders/track, driver route/stop/POD/weigh, in-app chat, customer live-weight line.

**Owner app:** not yet EAS-configured — `eas init` + the same app.json/eas.json/splash-plugin treatment, do after driver + customer land.

**Known non-blocking gaps in the first APKs (expected):**
- **Maps blank** until a Google Maps Android key is set (`app.json` → `android.config.googleMaps.apiKey`) — affects customer "track my truck" + driver route map.
- **Stripe** won't process until a `pk_test_` publishable key is provided (app boots fine without).

**Gotchas:** always `nvm use 20`; never `npm audit fix --force` (bumps off SDK 51, reintroduces the drift); `rm -rf android ios` before every cloud build; free-tier queue ~1 hr (Ctrl+C after upload, build continues; `eas build:list` to check).

**Sequencing:** collapse (Part 2) and the EAS build (Part 3) are independent — DB op vs mobile build — so they can run in parallel; founder chose collapse first. Neither needs an Inc-25 deploy. Log both executions to `CHANGELOG.md` (`[BLUE BEE]`, IST, newest on top) + a dated handoff.

---

## PART 4 — Founder manual + optional
- **Enter real CAD rates** on `/catalog` (per-kg/per-lb/per-item selectable) so the demo is priced, not "Get a quote." Add real Dry Cleaning garment items under the categories.
- **⚠️ Empty fleet — decide before the phone demo.** Post-collapse there are **zero Driver / fleet rows and no routes/stops**, so the **driver app opens to an empty route** and **live "track my truck" has nothing to track** — that's the back half of the MVP exit criteria (track → custody → deliver). To demo it on a phone, CC must seed a demo Driver + Vehicle + a Route with RouteStops tied to an order (demo org `11111111` only, clearly demo — consistent with the existing `seed.ts` demo-order approach, `priceFrom` stays null). Otherwise the demo is limited to book + catalog + pay. **Founder call: seed the demo route, or demo book-only.**
- **Demo login script (corrected):** owner `+14165550001` · customer `+14165550111` (Grace) · driver `+14165550006` (Demo Driver). All OTP `000000`. **Do NOT install the stale Expo APKs** (built from `27e9f0f`, pre-Inc-21 — no catalog grid, no Weigh screen); use only the new builds (`16c5ba0f` driver, `5206924b` customer).

---

## PART 5 — BRIEF: seed a demo route (founder chose this 2026-07-10) — CC executes, demo org `11111111` only

**Goal:** driver `+14165550006` logs into the driver app and sees a **published route with stops**; customer Grace `+14165550111` can **track her order**; the owner fleet/dispatch shows the vehicle. This lights up the track → custody → deliver half of the MVP on the phone.

**Steps:**
1. **Fleet entities (table is empty).** Create a Driver fleet entity + one demo Vehicle (a van) in org `11111111`, linked to the Demo Driver user `+14165550006`. Use the **real fleet/admin/dispatch path or a seed runner — not raw SQL** — so validations + lifecycle hold.
2. **Route.** Create a **today-dated** Route assigned to that driver + vehicle and **publish it** (the state that makes it appear in the driver app).
3. **Stops tied to EXISTING demo orders** (21 exist in the org): pick
   - ≥1 **WASH (FIXED)** order → shows weigh → auto-price on the phone,
   - ≥1 **SPECIALTY (FROM_MEASURED)** order → shows the quote → approve flow,
   - ≥1 stop whose order is **owned by Grace `+14165550111`** so her customer app can track it,
   - orders at a **pickup-ready lifecycle stage** (e.g. `SCHEDULED_PICKUP`) so the driver can walk `PICKUP_EN_ROUTE → PICKED_UP → INTAKE_INSPECTED` live.

**Constraints:** `org_id = 11111111` on every row · lifecycle + stop state machine **per PRD §5.1/§5.4, no invented statuses** (use the real transition path) · custody/scan events stay **append-only** (created by real scans during the demo, or seed an honest initial custody state — never mutate) · `priceFrom` stays null · clearly demo data (consistent with `seed.ts`'s existing demo order; honesty firewall — nothing presented as real capacity/customers).

**Live GPS:** the driver phone emits location **only during an active shift with location permission** (PRD §12.2) — grant it on the demo phone.

**Verify:** driver `GET` route → stops present · Grace reads + tracks her order · owner fleet/dispatch shows the route + vehicle · the order advances through a pickup from the phone.

---

## PART 6 — ⚠️ Google Maps key is on the critical path for the visual "track my truck"

The in-flight APKs (`16c5ba0f`, `5206924b`) were built **without a Google Maps Android API key** (known gap, 2026-07-09 EAS handoff). Tracking **data** flows (stop status, ETA, live weight), but the **map tiles render blank** — the truck-on-a-map view won't show. To demo live tracking *on a map*, the key must go into `apps/customer/app.json` + `apps/driver/app.json` (`android.config.googleMaps.apiKey`) and the apps **rebuilt** (another ~1 hr queue). **Founder decision:** supply the Maps key so CC rebuilds once the route seed is ready (visual map), **or** demo tracking via status/ETA/live-weight with a blank map today and add the key later. (Stripe similarly needs a `pk_test_` key to process a payment; the app boots without it.)
- **Optional:** deploy the Inc-25 seed/UI fixes (recurrence fix + dry-clean separation + empty-state guard) — not required for the phone demo, but stops the "1 card" class of bug returning. Ships via `railway up` (now safe to deploy the working tree once the EAS set is committed in sync).
