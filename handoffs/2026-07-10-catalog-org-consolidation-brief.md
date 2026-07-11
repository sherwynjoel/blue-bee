> ⚠️ **SUPERSEDED / CORRECTED 2026-07-10 — DO NOT FOLLOW THE ORIGINAL DIRECTION BELOW.**
> The diagnosis below mis-attributed the console session. Corrected facts (token decoded by CC):
> - `+14165550001` = "Demo Owner" (`sub 22222222`) → org **`11111111`** → returns the **8 cards**. This is the working login and the **canonical** org (founder decision, 2026-07-10).
> - `+14165550100` = "Pilot Owner" (`sub da1a939e`) → org `71a08dfc` → 1 hand-made card. This was the session I inspected; NOT the +14165550001 login.
> - There are **three** orgs: `11111111` (keep), `71a08dfc` (purge), "Demo Org 2" (purge).
> **Correct plan:** keep `11111111`; purge the two near-empty orgs. Do NOT purge `11111111` (it holds 15 users incl. the login + EAS test logins, 21 orders, a payment, 67 custody events).
> Authoritative record: `handoffs/2026-07-10-inc25-org-audit-and-seed-targeting.md`. Steps 2/6/7 below shipped and are correct; Steps 1/3/4/5 are replaced by the inc25 doc + the guardrails there.

# Claude Code brief — collapse to ONE org + land the catalog on the real login

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Branch:** `feature/s3-media-golive`
**Author:** planning/QC chat (diagnosis verified live against the owner console + the API's own authed response)
**Standing rules apply:** no stubs · back up before any destructive delete (reversible) · log `CHANGELOG.md` (`[BLUE BEE]`, IST, newest on top) + a dated handoff in `handoffs/` · commit ONLY your own paths — **do not touch the 18-entry uncommitted EAS workstream** (stash/pop around any `railway up`) · enums/lifecycle per PRD.

---

## The problem (root cause, verified — not a guess)

The live owner console shows **1 service card**, not 8. It is **not** a render bug, **not** a missing seed. It is an **org mismatch**:

- `bootstrap.ts` is the prod provisioner. It creates the real org with `randomUUID()` + the owner from `BOOTSTRAP_OWNER_PHONE`. The live `+14165550001` login authenticates into org **`71a08dfc-8f17-4ad5-b47b-10d3f0051392`** (confirmed by decoding the access token on `GET /v1/catalog/service-menu`, which returned `200` with `count:1`, `org_id:71a08dfc…`).
- `apps/api/prisma/seed-catalog.ts:17` **hardcodes** the DEMO constant `const ORG = '11111111-1111-4111-8111-111111111111'` (and `OWNER = '22222222-…'`). So every catalog seed "against live" wrote the 8 cards into the **demo** org `11111111`, which the real login never reads.
- The only row in `71a08dfc` is a stray **Wash & Fold** (`id 0fd5bc2e-af45-4240-8836-d7dd02a1017b`, `rate 1.5000`, `priceFrom null`) created via yesterday's console rate round-trip — a residue, not the seed's card.

**Decision (founder, 2026-07-10):** ONE org. Keep the login already in use → **`71a08dfc` is canonical.** Bring the catalog to it; delete the demo org `11111111`.

---

## Step 1 — Audit first (READ-ONLY, report back before mutating)

```sql
SELECT id, name FROM "Organization" ORDER BY name;                       -- expect 2: 71a08dfc + 11111111
SELECT name, org_id, active, sort_order, price_from FROM "ServiceCategory" ORDER BY org_id, sort_order;
```
Then enumerate EVERYTHING under `11111111` so we know the full blast radius of the purge, and specifically check for the `seed.ts` fabricated demo rows (honesty-firewall breach if present on prod):
- `ServiceCategory`, `Service` (garment items + prices), `MediaUpload` (+ the S3/MinIO objects under `org/11111111/catalog/…`)
- fabricated demo: `Account 44444444-…`, `Order 77777777-…`, `Tag 99999999-…`, any `Site`, `CustodyEvent`, `WeightCapture`
Under `71a08dfc`: confirm the single residue Wash & Fold (`0fd5bc2e…`) and that **no** `Order` / `WeightCapture` / line references it (safe to delete).

**Post the audit before proceeding.** Everything below is gated on it.

---

## Step 2 — Fix the seed targeting (code, the actual bug)

In `apps/api/prisma/seed-catalog.ts`: stop hardcoding the demo org. **Resolve the real org from the DB at runtime** (the single `bootstrap`'d org / the org of the `+14165550001` owner), and resolve `OWNER` to that org's owner `User.id`. This makes it structurally impossible to seed the wrong org again (fixes recurrence, not just today's symptom).

**Prod path = STRUCTURE ONLY** (honesty firewall):
- 8 service cards (`SERVICE_CARDS`) — `priceFrom` NULL, no backing rate Service. ✅ already how `create` works.
- 3 garment categories (Shirts / Outerwear / Formalwear) nested under Dry Cleaning — copy only.
- **NO sample items, NO sample prices, NO sample PNG tiles.** The current `CATEGORIES[].items` loop seeds `Dress shirt $6.00`, sample tiles, etc. — gate that behind an explicit `SEED_SAMPLE_ITEMS`/dev-only flag so **local/dev keeps its demo data** but **prod never ships a fake price**. The founder adds real Dry Cleaning items + prices via `/catalog`.

Confirm whether a "structure-only" entrypoint already exists (yesterday's handoff says a structure-only seed ran in-container) and wire the prod invocation to it. If it's just `seed-catalog.ts` with a flag, document the exact command.

---

## Step 3 — Reconcile the residue card

The deterministic seed creates Wash & Fold as `5e000000-0000-4000-8000-000000000001`. The existing residue `0fd5bc2e…` Wash & Fold would become a **9th, duplicate** card. Delete the residue (audit-confirmed `priceFrom null`, unreferenced) so exactly **8** cards remain. Its stray `1.5000` rate goes with it.

---

## Step 4 — Purge the demo org  ⚠️ DESTRUCTIVE — founder authorises, back up first

Delete org `11111111` and ALL its rows, **in a transaction, after `pg_dump` of those rows** (reversible):
- catalog: `ServiceCategory`, `Service`, `MediaUpload` (+ delete the matching S3/MinIO objects)
- fabricated demo (if the audit found them): `Order 77777777`, `Account 44444444`, `Tag 99999999`, sites, custody/weight rows
This restores the single-org invariant `bootstrap.ts` enforces (`Organization` count → 1).

> This step removes production rows. Do not run it until the Step 1 audit is reviewed and the founder says go. Keep the dump.

---

## Step 5 — Verify on live, as the REAL login (the proof — no stubs)

1. Console login `+14165550001` / OTP `000000` → decode the access token → **`org_id == 71a08dfc`**.
2. `GET /v1/catalog/service-menu` → **exactly 8 cards**, correct `sortOrder`, **every `priceFrom` NULL** (honesty firewall intact).
3. Dry-clean catalog → **3 garment categories**, nested under Dry Cleaning, **0 items, 0 prices**.
4. `SELECT count(*) FROM "Organization";` → **1**.
5. Customer + owner apps (same auth) show all 8 cards.

Show the evidence (token org claim, the 8-card JSON, the org count).

---

## Step 6 — Separation fix (smaller; same PR is fine)

Console **Dry-clean catalog** must render ONLY garment categories (`parentId` non-null / child of Dry Cleaning), never the top-level service cards. Today Wash & Fold (a weight/fixed card) shows up there asking for per-item garments — the founder flagged it. After the fix, confirm no service card leaks into the dry-clean section.

## Step 7 — Empty-state race (small)

The Service menu renders **"No service cards / Run the catalog seed"** during load / Railway cold-start, before data arrives — it misreads as "catalogue gone." Show a loading state; only render the seed CTA after a **confirmed empty 200**.

---

## Then (separate workstream, after the menu is confirmed live)

The EAS mobile build (driver weigh screen + customer live weigh line), still blocked on the lockfile-sync landmine (`package.json` + `package-lock.json` committed in sync or `npm ci` fails). Do not start it until the 8-card menu is verified live under `71a08dfc`, so the phone apps don't ship the 1-card gap.
