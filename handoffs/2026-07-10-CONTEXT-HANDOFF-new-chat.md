# BLUE BEE — context handoff for a new chat (2026-07-10, through Inc-29)

## What this is
Blue Bee = a commercial laundry & specialty-cleaning operating system for the Greater Toronto Area (customer app, owner app, driver app, web console, one NestJS backend). Repo: `/Volumes/Gowtham/Blue Bee` (canonical checkout), branch `feature/s3-media-golive`.

**Roles / boundary (important):** THIS chat plans, briefs, decides, and QCs. **Claude Code (VS Code on the Mac) writes and deploys the code.** This sandbox **cannot** reach Railway, the private DB, git, or EAS — the founder + CC run those. The pattern that's worked: CC builds an increment and reports proof → this chat independently audits by reading the actual shipped code → decisions get made here → CC executes. Every increment logs to `CHANGELOG.md` + a dated `handoffs/` file. Honesty firewall throughout: no fabricated data, prices, capacity, or claims.

## Live now
- **API** `https://api-production-d45a.up.railway.app` · **Console** `https://web-production-ba508.up.railway.app`
- **One org** (the accidental orgs were purged earlier): `11111111-1111-4111-8111-111111111111`.
- **Logins (all OTP `000000`):** owner `+14165550001` (Demo Owner, canonical) · customer `+14165550111` (Grace) · driver `+14165550006` (Demo Driver). Note: "Andre" `+14165550101` does **not** exist; the fleet has one seeded demo route (Demo Van 1).

## Deploy state — READ THIS
- **Deployed live:** Inc-24 (catalog + weight chain), **Inc-26** (saved addresses), **Inc-27** (console customer-360 + seed-UUID fix).
- **Built + verified but NOT deployed:** **Inc-28** (pickup scheduling) and **Inc-29** (item-ordering fix). → **Immediate action: batch-deploy Inc-28 + Inc-29 in one `railway up` (api + web)** — both migrations run at boot via `prisma migrate deploy`, Inc-29's is idempotent. Then the **EAS rebuild** (driver + customer) so the new customer screens reach phones.

## Recent increments (newest first)
- **Inc-29 — deterministic order-item ordering.** `Item.sortOrder` ordinal + backfill (`ROW_NUMBER`, null-scoped) + one `ITEM_ORDER_BY` constant on all 5 ordered item reads; closes an item-mispricing risk. **Independently code-audited by this chat — clean.** Not deployed.
- **Inc-28 — pickup scheduling.** Availability endpoint (honest capacity: real count or none), customer time-slot picker (deleted the hardcoded "tomorrow morning"), Admin→Scheduling control writing `Organization.settings.schedule`, and the inherit-on-create fix so the chosen window actually reaches `RouteStop.timeWindow`/optimizer/analytics. Independently audited — clean. Not deployed.
- **Inc-27 — console customer-360** (`/customers` + `/admin/customers`, read-only) **+ seed UUID fix.** Live.
- **Inc-26 — saved addresses.** Add/manage/pick; Nominatim geocoder behind a `GeocoderProvider` (Google was never provisioned); 3-state serviceability. Live.

## Customer-app Tier-2 backlog (the active workstream)
Order + tracker: `handoffs/2026-07-10-customer-app-tier2-backlog.md`.
- ✅ Step 1 Addresses (Inc-26) · ✅ (inserted) Console customer-360 (Inc-27) · ✅ Step 2 Pickup scheduling (Inc-28) · ✅ correctness fix (Inc-29).
- ⏳ Remaining, in order: **Step 3 ratings/CSAT** → Step 4 claims/exceptions → Step 5 notification prefs → Step 6 saved cards → Step 7 social/email login → Step 8 reschedule/cancel + tip. (Steps 3–5 are PRD-MVP items.)

## Founder-manual / non-blocking
- **Set real pickup hours** in Admin → Scheduling (a default ships visibly labelled until you do).
- **Enter real CAD rates** in `/catalog` (all 8 cards show "Get a quote" until then; per-kg/lb/item selectable). Add real Dry Cleaning garment items.
- **Google Maps Android key** + **Stripe `pk_test`** (Tier-1, parked): without them the phone map is blank and payment won't process. Keys go to CC / your password manager — never entered by this chat.

## Pre-launch known-state (accepted, not fixed)
- **OTP bypass `000000` is active on prod** — any known phone logs in as that user, including owners. **Hard go-live blocker before real customers.**
- **Seed drift on prod** (founder chose leave as-is): `+14165550030` is an extra full-owner login; the memorable `+11234567890` is dead.

## Known debt (flagged, not blocking)
- Pre-existing customer lint failures: `ChatScreen.tsx`, `OrderDetailScreen.tsx` (unmodified from HEAD).
- Web suite `CostCenters` `act()` flake under parallel jest (pre-existing timing; green on re-run).
- `OrderWeightView.customerEstimate` sums `line.measure` across mixed units (older flag).

## Feature facts worth carrying
- **Driver↔customer chat exists** (per-order, two-party, live only during the active delivery window; console is deliberately NOT a participant — moderation deferred).
- **Web console user visibility:** order/account context + the new customer-360; **no** staff view of the driver↔customer chat.
- **MVP status:** Phase 1 ~95%+ — backend + web console live; the remaining exit-criteria item is the on-device EAS build.

## Immediate next actions
1. **CC:** batch-deploy Inc-28 + Inc-29 (`railway up` api+web) + EAS rebuild (driver+customer).
2. **Founder:** set pickup hours + real CAD rates; hand CC the Maps/Stripe keys when ready.
3. **Next build:** Tier-2 **Step 3 (ratings/CSAT)** — brief it, build, this chat audits, deploy.

## Key files
PRD `docs/laundry-platform-PRD.md` · `CHANGELOG.md` · `BUILD-PLAN.md` · `handoffs/` (per-increment briefs: inc26 addresses, inc27 customer-360, inc28 scheduling, inc29 item-ordering; the Tier-2 backlog; this doc).
