# Handoff — 2026-07-10 · Inc-25: org audit, seed targeting fix, dry-clean separation, empty-state guard

**Branch:** `feature/s3-media-golive` · **Status:** code shipped + committed. **The org purge is NOT executed.**
Nothing was deleted from production.

---

## 1. The brief's root cause was wrong on its central fact

The brief stated that `+14165550001` authenticates into org `71a08dfc`. **It does not.** Decoded live:

```
POST /v1/auth/verify  {phone:+14165550001, code:000000}  -> 200
JWT: sub    = 22222222-2222-4222-8222-222222222222   ("Demo Owner")
     org_id = 11111111-1111-4111-8111-111111111111   (the DEMO org)
GET /v1/catalog/service-menu with that token -> 200, 8 cards, every priceFrom NULL
```

There is exactly **one** User row for that phone — no duplicate-phone / `findFirst` race. The only user in
`71a08dfc` is **`+14165550100` "Pilot Owner"**, so the 1-card console session was that login.

**Three orgs exist, not two:**

| Org | Name | Rows |
|---|---|---|
| `71a08dfc…` | Blue Bee Pilot — anchor org | 57 |
| `11111111…` | Blue Bee (demo operating org) | 302 |
| `e0000000-…-002` | Blue Bee — Demo Org 2 (isolation test) | 5 |

`Organization → 1` therefore also requires deleting Demo Org 2, which the brief doesn't mention.

**The `71a08dfc` residue is not seed debris.** It is a top-level `ServiceCategory` "Wash & Fold"
(`0fd5bc2e…`, priceFrom NULL, active) **with an attached ACTIVE `Service` "Garments" (unit ITEM, rate 1.5)** —
that looks hand-created in the console. (The inactive `1.5 / unit LB` service from the Inc-24 rate round-trips
is a *different* row, and it lives in the demo org.)

**Confirmed exactly as stated:** `seed-catalog.ts:17` really did hardcode `ORG = '11111111…'`. That is the real
bug, and it is now fixed. The fabricated demo rows (`Account 44444444`, `Order 77777777`, `Tag 99999999`) are
all present — in the **demo** org, not the pilot org. Zero `MediaUpload` rows ⇒ **no S3 objects to purge.**

## 2. Why Steps 3–5 were not executed

**Steps 4 and 5 contradict each other.** Deleting org `11111111` destroys **15 Users**, including
`22222222` = the `+14165550001` login that Step 5 verifies with. It also destroys the driver/customer test
logins (`+14165550101` Andre, `+14165550111` Grace) that the *next* workstream — the EAS mobile build —
depends on, plus 21 Orders, 8 Quotes, 3 Invoices, 1 Payment, 67 CustodyEvents, 20 Tags, 13 Sites, 2 Routes.

The founder was shown this and chose "execute the purge as written" + "delete the residue, back up first".

**Then the backup was blocked, so I stopped.** The standing rule is *back up before any destructive delete*:
- `pg_dump` cannot reach the DB: it's private (`postgres.railway.internal`), there is no public URL I'm
  permitted to read, and the api image ships **neither `pg_dump` nor `psql`**.
- I built a full-fidelity logical dump instead — every public table via `row_to_json` (which also captures the
  PostGIS `Site.geo` column that a Prisma-model export silently drops). The whole DB is **25 MB / ~386 real
  rows** (the other 8 500 are `spatial_ref_sys`), so a complete dump is trivial.
- **The sandbox denied the dump run**, and separately denied printing the postgres credentials. Both denials
  are reasonable. I did not work around either, and with no backup I did not delete.

### Two obstacles the purge will hit — solve these before running it
1. **`org_id` has NO foreign key to `Organization`.** Of 85 FKs in the live DB, **zero** reference
   `Organization`. So `DELETE FROM "Organization" WHERE id=…` cascades **nothing** and would leave 302 orphaned
   rows with a dangling `org_id`. The purge must delete **per table, in FK dependency order** (Order cascades
   Item → CustodyEvent/Inspection/Photo/Quote/OrderLine; but `Claim`, `Invoice→Account`, `LinenStock→Service`,
   `ParLevel→Service`, `Refund→Payment` are `SET NULL`/`RESTRICT` and need explicit handling), then the
   `Organization` row itself.
2. **Append-only triggers fire on cascaded deletes** — `AuditLog`, `CustodyEvent`, `WeightCapture`,
   `LinenMovement`, `ProcessedStripeEvent` all have `BEFORE DELETE OR UPDATE` guards. The demo org holds 15
   `AuditLog` + 67 `CustodyEvent` rows, so a naive purge dies partway. They must be disabled inside the same
   transaction (`ALTER TABLE … DISABLE TRIGGER …`, requires table owner) and re-enabled after.

### And decide the post-purge login
After the purge the only remaining owner is **`+14165550100`**. To satisfy Step 5 literally
(`+14165550001` → `org_id == 71a08dfc`) the freed phone must be re-pointed onto the Pilot Owner
(`UPDATE "User" SET phone='+14165550001' WHERE id='da1a939e…'`), which **retires `+14165550100`**. That's a
one-line, reversible identity change — but it's yours to confirm, and it must happen *after* the demo user is
gone (phone uniqueness).

## 3. What shipped (non-destructive — the actual recurrence fix)

### Step 2 — seed targeting (`apps/api/prisma/seed-catalog.ts`)
`const ORG = '11111111…'` is **deleted**. New `resolveSeedTarget()`:
1. explicit `orgId`/`ownerId` args → 2. `SEED_ORG_ID` / `SEED_OWNER_ID` → 3. **the single `Organization`**;
with more than one and no explicit target it **refuses to guess** and names them. Owner falls back to the
org's `OWNER` grant. Seeding the wrong org is now structurally impossible.

**Sample items are DEV-ONLY.** `sampleItems` (caller) / `SEED_SAMPLE_ITEMS=1` (env), **default OFF**. A prod
run seeds structure only and never constructs the S3 client, so no sample price or tile can reach prod.
`seed.ts` passes `{ orgId: ID.org, ownerId: ID.owner, sampleItems: true }` → **local dev is unchanged**.

**New committed prod entrypoint** `prisma/seed-catalog-structure.ts` + `npm run db:seed:catalog`. Yesterday's
"structure-only seed" was an ad-hoc script piped into the container that **never entered the repo** — that gap
is now closed, and the entrypoint refuses `SEED_SAMPLE_ITEMS=1`.

```
# prod (inside the api container; runtime image has ts-node but no tsconfig)
railway ssh --service api
cd /app/apps/api
SEED_ORG_ID=71a08dfc-8f17-4ad5-b47b-10d3f0051392 \
  npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
  prisma/seed-catalog-structure.ts
```

Verified locally, all three guardrails:
- no `SEED_ORG_ID` with several orgs → *"refusing to guess the target org: found 2 organizations (…)"*
- `SEED_SAMPLE_ITEMS=1` on the structure entrypoint → refused
- explicit `SEED_ORG_ID` → resolves the OWNER grant, logs `STRUCTURE ONLY — 0 sample items, 0 sample prices, 0 S3 writes`

**Gotcha, now documented in code:** the upsert re-asserts `sortOrder`, so **re-seeding clobbers a console
reorder**. Reorder after seeding, never seed after reordering.

### Step 6 — dry-clean separation (`catalog-admin.service.ts`)
`adminCatalog` listed **every** category, so top-level service cards leaked into the console's dry-clean
section (Wash & Fold asking for per-item garment prices). Now filtered to `parentId: { not: null }`.

**Subtlety handled:** an ITEM service attached to a top-level card would then have silently disappeared — the
pilot org's `Garments` is exactly that. Such items now surface in the `uncategorized` bucket rather than being
dropped off-screen. Two e2e tests pin both halves.

### Step 7 — empty-state race (`ServiceMenuAdmin.tsx`, `CatalogAdmin.tsx`)
The "Run the catalog seed" CTA now requires a **confirmed payload**: error → error box; `loading || !data` →
skeleton; only then the empty state. `useAsync` does start `loading: true`, so I could **not** reproduce a
mount-time flash — but the CTA was reachable whenever loading went false without data ever arriving.
**The new test is meaningful, not decorative:** "settles with no payload" **fails against the old guard** and
passes against the new one (verified by temporarily reverting the guard).

## 4. Verification
api unit **240/240** · catalog-dryclean e2e **13 → 15** (+2 separation) · web **148 → 152** (+4 empty-state) ·
customer **108/108** · `tsc` clean (api/web/customer) · no-stub sweep clean across all 9 changed files.

**Not deployed.** This is code only; the live console still runs Inc-24 until the org decision is executed.
The 18-entry EAS workstream was never touched (no `railway up` was run, so no stash was needed).

## 5. Next
1. **Decide + execute the purge** with a backup. It needs (a) a permitted backup path, (b) per-table FK-ordered
   deletes, (c) the append-only triggers disabled in-transaction, (d) the post-purge login decision.
   I can write and run it once you grant the destructive-DB permission (or run the script yourself).
2. Then deploy Inc-25 (`railway up` api + web — **stash the EAS work first**) and seed the pilot org:
   `SEED_ORG_ID=71a08dfc… npm run db:seed:catalog` in-container → 8 cards, priceFrom NULL.
3. Then Step 5's verification, and only then the EAS mobile build.
