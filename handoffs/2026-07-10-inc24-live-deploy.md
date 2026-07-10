# Handoff — 2026-07-10 · Inc-24 live deploy + live catalog verified populated

**Branch:** `feature/s3-media-golive` · **Deployed commit:** `ba2dc06` (Inc-21 `5d65ae4` → Inc-24)
**Scope:** Railway `api` + `web` only. The Expo driver/customer apps still need a separate EAS build.

## Live
- **API:** https://api-production-d45a.up.railway.app — deploy `37f51abf` **SUCCESS**
- **Console:** https://web-production-ba508.up.railway.app — deploy `27595f4a` **SUCCESS**
- **Login:** OWNER `+14165550001`, OTP `000000` (staging fixed bypass). → **Catalog & pricing**.

## §0 Branch hygiene
`railway up` uploads the **working tree**, not a git ref. The uncommitted EAS-enablement workstream (root
`package.json` + `package-lock.json` — the out-of-sync lockfile — plus eas.json/tsconfig/app.json/plugins and
untracked docs) would have ridden along and broken the api/web `npm ci`. Stashed with `git stash push -u`,
deployed the clean tree, then `git stash pop`. The tree is back to 18 entries, byte-for-byte, still
uncommitted. **Nothing of that workstream was committed or shipped.**

## §1 API deploy + the ADD VALUE risk (retired, not assumed)
The Inc-24 migration is `ALTER TYPE "PricingUnit" ADD VALUE 'PER_LB'`. Postgres forbids `ADD VALUE` inside a
transaction on **< 12**, and Prisma wraps each migration in one — a failure would crash-loop the api on boot,
because the Dockerfile CMD is `prisma migrate deploy` *then* `node dist/main.js`.

**Checked first:** live Postgres is **16.14**. PG ≥ 12 allows `ADD VALUE` in a transaction as long as the new
label isn't *used* in the same transaction — our migration only adds it. It applied cleanly.

Confirmed in-container after deploy:
- `npx prisma migrate status` → **"Database schema is up to date"**, **22 migrations** (was 21)
- `_prisma_migrations`: `…_catalog_service_menu_inc21`, `…_weight_capture_inc22`,
  `…_pricing_unit_per_lb_inc24` all `applied=true`; **0 unfinished**
- live enum: `PricingUnit = PER_ITEM, PER_KG, PER_MEASURE, PER_LB`
- Inc-22 `WeightCapture` append-only trigger present
- Inc-23's re-quote edge (`QUOTE_APPROVED → QUOTED`) is **code-level** in `lifecycle.ts` — it ships with the
  image, there is no migration to look for.

## §2 The seed premise was wrong — corrected
The task assumed the live DB had **0 cards** because the catalog seed had only run locally. **It hadn't.** The
structure-only seed *did* run in-container against LIVE on 2026-07-10 03:20; the live demo org already held the
8 cards + 3 nested categories. What was actually missing was **Inc-24 itself**.

I re-ran the same idempotent structure-only runner anyway to confirm state (it upserts; its update branch
never touches `priceFrom` / `unit` / `pricingModel` / rate). Live demo org `11111111-…` now:

- **8 top-level cards**, every `priceFrom` **NULL**, no active backing rate
- **3 garment categories** (Shirts / Outerwear / Formalwear) nested under Dry Cleaning
- **0 garment items, 0 sample prices, 0 S3 uploads**
- `GET /v1/catalog/home` → 8 cards, every `priceFrom` null, every `serviceId` null

The **full demo seed was NOT run against prod** (per the runbook).

## §3 Web deploy — the shipped bundle was verified, not assumed
Beyond "the build went green": pulled the 14 JS chunks that `/catalog` references (654 KB) and grepped the
deployed code. All Inc-24 markers present: `Per pound (lb)`, `Per kilogram`,
`Only icons the customer app can render`, `(unsupported)`, `catalog/reorder`, `SERVICE_CARDS`, `Move `,
`wash-fold` … `formalwear`.

## §4 Verified on LIVE as OWNER
| Check | Result |
|---|---|
| `/catalog` service menu populated | `GET /catalog/service-menu` → **8 cards** (editor renders, not the "Run the catalog seed" empty state) |
| Per-pound unit accepted by the live API | PATCH `{unit: PER_LB, rate: 1.50, priceFrom: 1.50}` → **200** |
| `backingServiceUnit(PER_LB) → LB` in prod | live DB: backing `Service` re-mapped to **`unit=LB`**, `active=true` |
| Rate round-trip + revert | reverted to `{unit: PER_KG, rate: null, priceFrom: null}` → **all 8 cards null again** |
| Non-owner gate | Rita `+14165550010` → **403** on service-menu GET, PATCH, **and** the new `/catalog/reorder` |
| Reorder persists + app renders it | swap cards 1↔2 → `sortOrder` renumbered **0..7** → **`GET /catalog/home` returned the flipped order** → fresh read confirms it survives reload → original order restored |

**Not verifiable headlessly** (client-rendered, behind auth): the *visual* render of the icon-picker glyph
preview and the arrow buttons. API + DB + shipped-bundle evidence all confirm they are deployed. Eyeball once
at the console URL.

## ⚑ Two things to know

**1. Re-running the structure seed CLOBBERS a console reorder.** The seed's update branch re-asserts
`sortOrder` 1..8 (it never touches prices). A console reorder renumbers to 0..n-1. So: **reorder after
seeding, never seed after reordering.** I used exactly this to restore the original order after the §4 proof.

**2. One INACTIVE backing rate `Service` remains** on Wash & Fold (baseRate 1.50, unit LB), residue of the
rate round-trips. Clearing a rate **deactivates** rather than deletes (a live order could reference one). It is
invisible everywhere — `toServiceMenuCardView` gates on `active` so the console reads `rate: null`, and
`/catalog/home` filters `active: true` so `serviceId` is null. Verified **0 references** across all six tables
carrying a `service_id` FK. I tried to delete it as cleanup; the sandbox **correctly refused** an unrequested
destructive prod-DB mutation, so it stays. Either say the word and I'll remove it, or ignore it — the founder's
first real Wash & Fold rate overwrites it (the code re-maps the unit and reactivates the same row).

## Next
1. Log in and enter **real CAD rates** on the 8 cards (still all NULL by design). Per-pound is now selectable;
   entering a rate auto-creates the WASHFOLD backing service. The plant still weighs in **kilograms** — pricing
   converts kg→lb once, at pricing time.
2. Add real garment items under Dry Cleaning (`POST /catalog/items` + image presign are wired). `baseRate` is
   non-nullable, which is why no price-less items were seeded.
3. Separate task: the **EAS Android build** for the driver/customer apps (fix the lockfile first) — see
   `handoffs/2026-07-09-eas-android-build-enablement.md`.
