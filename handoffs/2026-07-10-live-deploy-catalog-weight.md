# Handoff — 2026-07-10 · Inc-21/22/23 catalog + weight chain DEPLOYED TO LIVE

**Branch:** `feature/s3-media-golive` · **Scope:** Railway `api` + `web` console only. The Expo driver/customer apps
(driver weigh screen, customer live-weight line) are **NOT** in this deploy — they need a separate EAS build (§4).

## Live URLs + login
- **API:** https://api-production-d45a.up.railway.app  (deployment `95814bda`, SUCCESS)
- **Web console:** https://web-production-ba508.up.railway.app  (deployment `407181f5`, SUCCESS)
- **Login:** demo OWNER `+14165550001`, OTP `000000` (staging fixed-bypass; `SMS_TRANSPORT=console`, `NODE_ENV=staging`).
  Other seeded roles share the `000000` bypass (DISPATCHER `…2`, CSR `…3`, PLANT `…4`, FINANCE `…5`, DRIVER `…6`, RITA/customer `+14165550010`).

## What went live
Inc-21 service menu + Inc-22 weight→price backend + Inc-23 P0–P6 (Book→catalog, driver weigh API, dashboard live
weight + override, customer live line, re-quote-after-approval, QC). The **driver/customer UIs** for weigh are in the
Expo apps and are deferred to EAS; everything the **dashboard + API** need is live.

## §0 — Branch hygiene (why it mattered)
`railway up` ships the **working tree**, not a git ref. The uncommitted **EAS-enablement workstream** (root
`package.json` + `package-lock.json` — the known out-of-sync lockfile landmine — plus `eas.json`/`tsconfig`/`app.json`/
`plugins/` under apps/customer + apps/driver, and untracked docs/handoffs) would have ridden along and **broken the
api/web `npm ci`**. Isolated it with `git stash push -u` → `stash@{0}` → clean tree = exactly the committed set
(`5d65ae4`, `3649576`, `465cb43`, `b8f9476`, `6530a1c`, `9acfb41`, `b375e71`, `7919435`). Deployed, then `git stash pop`
restored the EAS work untouched. **The EAS workstream is exactly as it was — nothing of it was committed or shipped.**

## §1 — API deploy + migrate
- `railway up --service api --ci` → `95814bda` SUCCESS.
- Migrations are applied by the **Dockerfile CMD** (`prisma migrate deploy` with a bounded retry, then `node dist/main.js`)
  — NOT a manual step. Confirmed inside the container: `railway ssh --service api npx prisma migrate status` →
  **"Database schema is up to date! 21 migrations found"** (Inc-21 catalog, Inc-22 `WeightCapture` + append-only trigger,
  Inc-23 re-quote edge all present). `/v1/catalog/home` went **404 → 401** (route now exists, auth-gated).
- **Single replica** matters (the runbook): two boots would race the migrator. Keep api at 1 replica.

## §2 — Catalog seed (STRUCTURE ONLY — founder decision)
Founder chose **structure only, no sample prices** (same honesty firewall as everywhere). Seeded idempotently into the
demo org `11111111-…` via a structure-only runner (the 8-card + 3-category subset of `seed-catalog.ts`, run in the
container against the live DB):
- **8 top-level service cards**, every `priceFrom = NULL`, **no backing rate `Service`**.
- **3 garment categories** (Shirts / Outerwear / Formalwear) **nested under the Dry Cleaning card**.
- **0 garment items, 0 sample prices, 0 S3 uploads.** The pre-existing stray top-level "Shirts" (a prior partial seed,
  id `ca000000-…-001`) was **reparented** into the sub-catalog — no 9th Home card.
- Live-DB verification: `TOP_CARDS(8)` all `priceFrom:null`; `NESTED_UNDER_DRYCLEAN(3)`; `GARMENT_SERVICES=0`; cards with
  a non-null price/rate = **0**.
- **Founder to do:** in `/catalog` (Catalog & pricing), enter real CAD rates on the 8 cards, and add real garment items
  (photo + price) under Dry Cleaning — `POST /catalog/items` + `POST /catalog/image/presign` are wired. `baseRate` is
  non-nullable, which is why no price-less garment items were seeded.

## §3 — Web console deploy + verification
- `railway up --service web --ci` → `407181f5` SUCCESS (cleared the 8-day-old FAILED deploy). `NEXT_PUBLIC_API_BASE_URL`
  already points at the live API; `CORS_ALLOWED_ORIGINS` already allows `web-production-ba508` — no CORS edit needed.
- Verified headlessly as **OWNER `+14165550001`**:
  - `/`, `/catalog`, `/orders` serve **200**.
  - `GET /v1/catalog/service-menu` → **8 cards**, all `priceFrom`/`rate` null.
  - **Rate round-trip:** PATCH Wash & Fold `priceFrom/rate = 3.50` → persisted (200) → PATCH back to `null` (200) →
    all 8 cards null again. **Nothing fake left in the pilot.**
  - **Non-owner Rita `+14165550010`** → **403** on GET *and* PATCH `/catalog/service-menu` (owner/finance gate holds).
  - Dashboard weight-panel backend `GET /orders/:id/weight` → **200** with the real `OrderWeightView`
    (`authoritativeWeightKg`, `authoritativeWeighPoint`, `captures`, `customerEstimate`).
- **Not verifiable headlessly (needs a browser):** the visual render of `ServiceMenuAdmin` / `WeightPanel` and the
  "Catalog & pricing" sidebar. Repro: log in at the console URL as `+14165550001` / `000000` → **Catalog & pricing**
  shows the 8-card rate editor above the Dry Cleaning garment sub-catalog; open any order → the live-weight panel.

## §6 — Polish
Sidebar label **"Dry-clean catalog" → "Catalog & pricing"** (`apps/web/components/AppShell.tsx`) — the `/catalog` page now
renders the full 8-card menu + rate editor (`ServiceMenuAdmin`) above the garment sub-catalog (`CatalogAdmin`). The
`CatalogAdmin` section's own header stays "Dry-clean catalog" (it names that section accurately). Shipped in the web redeploy.

## §4 — Mobile apps (FLAG — deliberately deferred, option a)
The **driver weigh screen** + **customer live "Weighed X kg → $Y" line** live in the Expo apps and are **not** delivered by
this Railway deploy. They need an **EAS build**, which is gated on the known lockfile-sync landmine
(`@react-navigation/bottom-tabs` + the uncommitted EAS deps → `npm ci` fails until `package.json` + `package-lock` are
committed in sync). **Chosen: stop after web+API** so the founder can enter real rates + demo the live-weight **dashboard**
now. The EAS build (resolve the lockfile first; see `handoffs/2026-07-09-eas-android-build-enablement.md`) is its own task.

## Next
1. Founder: enter real CAD rates on the 8 cards + add real garment items in **/catalog** (still all NULL/empty by design).
2. Then a weigh flow lights up the live dashboard weight panel end-to-end.
3. Separate task: the EAS Android build for the driver/customer weigh UIs (fix the lockfile first).
4. Separate hygiene task (pre-existing, not this deploy): make the e2e suite self-isolating (cross-spec contamination).
