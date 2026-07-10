# Handoff — 2026-07-10 · One org (purge executed) + EAS Android builds fired

**Branch:** `feature/s3-media-golive` · **HEAD:** `be14265`
**Live:** api `https://api-production-d45a.up.railway.app` · console `https://web-production-ba508.up.railway.app`
**Canonical login:** `+14165550001` "Demo Owner" → org `11111111-1111-4111-8111-111111111111`

---

## Part 2 — Collapse to one org (DESTRUCTIVE, executed, verified)

### Backup (guardrail 1) — taken and verified BEFORE any delete
`pg_dump`/`psql` are unusable here (DB is private; the api image ships neither). So: a **full logical dump** of
all 56 public tables via `row_to_json` — which also captures the PostGIS `Site.geo` column that a
Prisma-model export silently drops.

```
/Volumes/Gowtham/blue-bee-backups/bluebee-pre-collapse-20260710T152711.json.gz
24 KB · 56 tables · 392 rows · sha256 16ffec3eeb79ed63a7b5267d344d9dc6de8635c235bdc847a2244f9bb9cfdb95
```
Verified restorable: gunzips, parses, contains all 3 Organizations, all 17 Users, all 68 doomed rows, and
`Site.geo` as EWKB hex. **Founder reviewed before the delete.**

### Pre-flight findings that shaped the purge
- **`org_id` has NO foreign key to `Organization`** (0 of 85 FKs reference it). `DELETE FROM "Organization"`
  cascades **nothing** and would orphan every child row. → per-table deletes in explicit FK-safe order.
- **Append-only triggers fire on cascaded deletes** — `AuditLog`, `CustodyEvent`, `WeightCapture`,
  `LinenMovement`, `ProcessedStripeEvent`. → disabled inside the transaction, re-enabled before commit.
- **Cross-org referential check: 0 danglers.** Nothing in the surviving org points at doomed data.

### Execution
Ran the **identical transaction as a DRY RUN first** (deliberately rolled back; confirmed the DB still had 3
orgs afterwards), then for real. One transaction, with assertions gating the COMMIT:

```
DELETED = { AuditLog:28, RefreshToken:23, OtpChallenge:6, UserRole:2, User:2,
            Organization:2, Account:1, Order:1, Service:1, ServiceCategory:1, ServiceZone:1 }   = 68 rows
ASSERT   Organization = 1  AND  it is 11111111  AND  +14165550001 exists in it  AND  8 top-level cards
COMMITTED
```
Delete order: `AuditLog, OtpChallenge, RefreshToken, ServiceZone, Service, ServiceCategory, Order, Account,
UserRole, User, Organization` (Order before Account satisfies the `Order→Account` RESTRICT edge).

The hand-made `Wash & Fold` category and its `Garments` service lived in `71a08dfc`, so they went with the
org — no separate residue step was needed.

### Verified on live
| Check | Result |
|---|---|
| `SELECT count(*) FROM "Organization"` | **1** (`11111111`) |
| Append-only triggers | all 5 back to `enabled = O` |
| `+14165550001` token `org_id` | **`11111111`** ✓ |
| `GET /v1/catalog/service-menu` | **8 cards**, 0 non-null `priceFrom`, 0 non-null `rate` |
| `+14165550111` (Grace), `+14165550006`/`0007` (drivers) | login **200** |
| `+14165550100`, `+14165559001` | **401** — retired, as intended |
| Users outside the keep org | **0** |

### ⚑ Correction to the brief
**`+14165550101` "Andre" does not exist in the live database**, and there are **zero `Driver` rows** (the
fleet table is empty). The real driver logins are **`+14165550006` "Demo Driver"** and `+14165550007`
"Demo Driver 2". Grace `+14165550111` is real and survived. This blocked nothing (Andre was never in a doomed
org — he was never seeded at all), but **the phone-demo script must use `+14165550006`**, not `+14165550101`.

---

## Part 3 — EAS Android builds

### Step 0 — the lockfile landmine is retired (`be14265`)
**`npm ci` passes clean at Node 20.20.2 and does NOT modify `package-lock.json`.** package.json and the
lockfile were *already* in sync on disk — they had simply never been committed. `postinstall` built
`packages/shared/dist` (78 files) + `packages/api-client/dist` (15 files); `expo-font` resolves to the pinned
`12.0.10`.

Committed exactly: root `package.json` (`overrides.expo-font=12.0.10`, `postinstall`), `package-lock.json`,
`apps/driver/{app.json, eas.json, package.json, plugins/}`,
`apps/customer/{eas.json, package.json, tsconfig.json, plugins/}` and the deletion of `apps/customer/expo-env.d.ts`.

Two notes:
- `apps/customer/app.json` was **already committed** referencing `./plugins/withSplashscreenBackgroundColor.js`
  while that file was untracked — a fresh clone was broken. Committing `plugins/` fixes it.
- The customer's `expo-env.d.ts` deletion had to ship **with** the tsconfig `include` change; leaving the
  include entry pointing at a deleted file breaks `tsc`.

**Side benefit: the tracked tree is now clean, so `railway up` no longer needs the stash/pop dance.**

### Step 1 — local verification, then the cloud builds
Per app (`nvm use 20` — the shell was already 20.20.2):
1. `rm -rf android ios` (a leftover `android/` makes EAS detect a **BARE** workflow → `runtimeVersion
   {policy: appVersion}` unsupported → upload error).
2. `npx expo prebuild -p android --no-install` → confirmed **`<color name="splashscreen_background">` is
   DEFINED in `android/app/src/main/res/values/colors.xml`** *and* referenced by
   `drawable/splashscreen.xml`. That mismatch is exactly what killed the previous build at
   `:app:processDebugResources`; the local config plugin now defines it.
3. `npx expo export -p android` → Hermes bundle emitted (driver `dist` 6.7 MB, customer 6.8 MB).
4. `rm -rf android ios dist`, then `eas build -p android --profile preview --non-interactive --no-wait`.

**Builds fired** (existing Expo keystore reused; `EXPO_PUBLIC_API_BASE_URL` baked from the `preview` profile):

| App | Build id | Logs |
|---|---|---|
| driver | `16c5ba0f-785b-4516-ad18-4447aa282bb0` | expo.dev/accounts/gautam1337/projects/blue-bee-driver/builds/16c5ba0f-… |
| customer | `5206924b-e6c1-4884-a753-913ef8eaeca4` | expo.dev/accounts/gautam1337/projects/blue-bee-customer/builds/5206924b-… |

Check with `eas build:list --platform android --limit 3` (or `eas build:view <id> --json`; note `build:view`
does **not** accept `--non-interactive`).

**The pre-existing APKs are stale.** Both were built from `27e9f0f` ("S3 media go-live") — *before* Inc-21…24.
They have no catalog Home grid, no driver Weigh screen and no customer live-weight line. Use the new builds.

### Owner app — not EAS-ready (deferred per brief)
No `extra.eas.projectId`, no `plugins/withSplashscreenBackgroundColor.js`, and it still carries the invalid
top-level `newArchEnabled` (SDK 51 rejects it). Needs `eas init` + the same app.json/eas.json/splash treatment.
`eas init` will prompt about two accounts (`gautam1337` vs `gautam1337s-team`) — pass `--force` or set
`expo.owner`.

### ⚑ Two self-inflicted slips, both cleaned up
1. A backtick inside a double-quoted shell string **command-substituted and actually ran `eas init`** at the
   repo root. It failed on the multi-account prompt (created no EAS project) but wrote an empty
   `{"expo":{}}` `app.json` at the repo root — **deleted**.
2. `expo prebuild` rewrote `apps/customer/package.json`'s npm scripts to bare-workflow (`expo run:android`) —
   **reverted**. EAS builds from `eas.json`, so the uploaded archive is unaffected.

---

## APKs — BUILT ✅ (both FINISHED, from `be14265`, i.e. **with** Inc-21…24)
| App | Build | APK |
|---|---|---|
| driver | `16c5ba0f` | https://expo.dev/artifacts/eas/lZQa5g6cgt0p9lNnvUUF25r1lbsL3AyyfMGCYa5Sdvs.apk |
| customer | `5206924b` | https://expo.dev/artifacts/eas/p6oslVFzq45eGteC8kwjpis4goXnjbD5U-v-yeNHmcc.apk |

**Do not install the older Expo APKs** — they were built from `27e9f0f` (pre-Inc-21): no catalog Home grid,
no driver Weigh screen, no customer live-weight line.

---

## Part 5 — demo route, seeded through the REAL API (no raw SQL)

### Corrections found by auditing first
1. The org already had **2 Routes + 7 RouteStops** — but both routes are **COMPLETED**, June-dated, with
   `driverId`/`vehicleId` NULL. Only `Driver` and `Vehicle` were genuinely empty.
2. **No order was tied to a priced FIXED card.** Every active `Service` has `categoryId = NONE`, and the 8
   cards have no backing rate by design. Reading the gate settled it:
   `hasSpecialty() = services.some(s => s.category?.pricingModel === FROM_MEASURED)` — a **null category is
   treated as all-FIXED**, so a wash order **auto-prices on weigh**; and the specialty quote→approve path runs
   through `QuoteService`, independent of that gate. **No catalog surgery was needed and none was done** —
   re-verified after seeding: 8 cards, 0 non-null `priceFrom`, 0 non-null `rate`.

### What was created (all org `11111111`, all notes-tagged `DEMO —`)
| Step | Endpoint | Result |
|---|---|---|
| Vehicle | `POST /v1/vehicles` | `Demo Van 1` / `DEMO-001` / ACTIVE — `16fc4f5c` |
| Driver (fleet) | `POST /v1/drivers` | linked to Demo Driver user `e1000000-…-005` (`+14165550006`) — `56bb9dbf` |
| Wash order | `POST /v1/orders` | Grace's account/site; `Wash & fold — per pound` (LB, $2.50/lb) → auto-prices on weigh (Inc-24 converts the kg capture → lb at pricing time) |
| Specialty order | `POST /v1/orders` | Grace's account/site; `Area rug hand-wash (wool)` (SQFT, $6.50) → measure at intake → quote → approve |
| Pickup-ready | `POST /v1/orders/:id/schedule-pickup` ×2 | both **SCHEDULED_PICKUP** |
| Route | `POST /v1/routes` | today-dated, driver + vehicle assigned — `bf3536ad` |
| Stops | `POST /v1/routes/:id/stops` ×3 | seq1 PICKUP wash · seq2 PICKUP rug · seq3 **DELIVERY of Grace's existing `DELIVERY_EN_ROUTE` order `…106`** |
| Publish | `POST /v1/routes/:id/publish` | **PUBLISHED** |

### Verified as the real principals (not as owner)
- **Driver `+14165550006`** → `GET /v1/driver/assignment` → route `bf3536ad`, **PUBLISHED**, dated today,
  **3 stops PENDING**. That is exactly what the driver app opens to.
- **Grace `+14165550111`** → sees **6 orders**, including both new demo pickups;
  `GET /v1/orders/…106/tracking` → **200** with `stop` + a **`channelToken`** (what her app uses to open the
  `/live/vehicle` socket).
- **Owner** → `/v1/fleet/live` 200 · `/v1/routes/:id` PUBLISHED w/ driver + vehicle + 3 stops ·
  `/v1/vehicles` → `Demo Van 1`.

### `vehicle: null` in tracking is CORRECT, not a bug
`tracking-read.service.ts`: *"when no stop is active or no vehicle is assigned/positioned, `vehicle` is null
(never a leak)."* The stops are `PENDING` and no GPS row exists. **The truck appears once the driver starts a
shift with location permission and departs a stop** (PRD §12.2). Grant location on the demo phone.

---

## Phone-demo script
Download each APK → allow unknown sources → install → login by phone OTP `000000`:
- **Customer `+14165550111`** (Grace): Home 8-card catalog · Orders (2 new DEMO pickups) · Track (order `…106`)
  · live "Weighed X kg → $Y" once the driver weighs.
- **Driver `+14165550006`** (Demo Driver) — **not `+14165550101`, which does not exist**: opens to today's
  published route with 3 stops → start shift (grant location) → depart/arrive/start → **Weigh** the wash order
  → it auto-prices at $2.50/lb → complete → POD on the delivery stop.
- **Owner** console `+14165550001`: fleet/dispatch shows Demo Van 1 + the route; the order detail shows the
  live weight panel.

Expected, non-blocking: **map tiles blank** (no Google Maps key — see below); **Stripe** inert until a
`pk_test_` key. Tracking *data* (stop status, ETA, live weight) flows regardless.

---

## ⚠ Google Maps key — founder decision, on the critical path for the visual map
Both APKs were built **without** `android.config.googleMaps.apiKey`. Tracking data works; the map renders
blank. To show the truck on a map: add the key to `apps/customer/app.json` + `apps/driver/app.json` and
**rebuild** (another ~1 hr free-tier queue). Otherwise demo tracking via status/ETA/live-weight today.

## Next
1. Founder: enter **real CAD rates** on `/catalog` (all 8 cards are `priceFrom: NULL` by design); add real
   Dry Cleaning garment items.
2. Founder: supply the **Google Maps Android key** (and optionally a Stripe `pk_test_`) → CC rebuilds both APKs.
3. Optional: deploy **Inc-25** (`df14f50` — seed-targeting fix, dry-clean separation, empty-state guard).
   `railway up` is now safe on a clean tree. Not required for the phone demo.
4. Owner app EAS enablement (`eas init` — it will prompt about `gautam1337` vs `gautam1337s-team`; also strip
   its invalid top-level `newArchEnabled` and add the splash plugin).
