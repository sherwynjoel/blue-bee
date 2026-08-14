# Blue Bee — Developer Handover

**Date:** 2026-08-12 · **Audience:** the incoming developer / technical partner
**Prepared from:** a live audit of the repo, git history, build state, and the running Railway environment.

Everything in this document was verified against the code and the live environment on 2026-08-12. Where
something is *not* built, it says so plainly — nothing here is aspirational.

---

## 0. The 60-second version

- The live project is **`/Volumes/Gowtham/Blue Bee`** on branch **`feature/customer-ux`**.
  `bluebee-integration` is a **stale git worktree** of the same repo — ignore it.
- The **backend is essentially complete and production-shaped**: 42 controllers, **216 REST endpoints**,
  59 Prisma models, 28 migrations, 2 WebSocket channels. **977 unit tests pass, plus 466 API e2e tests.**
- The **API and web console are live and healthy** on Railway right now.
- The gap to a customer-facing launch is **not backend capability**. It is:
  1. **Credentials for 5 third-party services** that are still running in sandbox/local mode (~1 day of work),
  2. **The customer mobile app's last mile** — a set of honest "Coming soon" rows that need real screens,
  3. **Mobile release engineering** — Android Maps key, EAS config bugs, store submission,
  4. **Security hardening** that was deliberately deferred (pen test, load test, console token storage).

**3 commits of the newest customer-app work are committed locally but NOT pushed to GitHub.** Push them
before any machine handover or that work is lost with the drive.

---

## 1. Which folder is live?

**`/Volumes/Gowtham/Blue Bee`** — this is the real repository and the one to hand over.

| | `/Volumes/Gowtham/Blue Bee` | `/Volumes/Gowtham/bluebee-integration` |
|---|---|---|
| What it is | **The git repository** (`.git/` directory) | A **git worktree** — `.git` is a 69-byte pointer file |
| Branch | `feature/customer-ux` | `chore/railway-verify` |
| Last commit | **2026-07-17** (`d759f05`) | 2026-06-27 (`a1a01ae`) |
| Contents | Full repo + `docs/`, `handoffs/`, design references | Same tree, ~7 weeks stale |

Proof:

```bash
cd "/Volumes/Gowtham/Blue Bee" && git worktree list
```

```
/Volumes/Gowtham/Blue Bee             d759f05 [feature/customer-ux]
/Volumes/Gowtham/bluebee-integration  a1a01ae [chore/railway-verify]
```

Both folders point at the *same* commit database, so nothing is lost by deleting the worktree. To remove it
cleanly once the handover is done:

```bash
cd "/Volumes/Gowtham/Blue Bee" && git worktree remove ../bluebee-integration
```

**Remote:** `https://github.com/onskim/blue-bee.git`

### ⚠️ Git state needs attention before handover

| Issue | Detail | Action |
|---|---|---|
| **Unpushed work** | 3 commits on `feature/customer-ux` exist only on this drive: `ef3df1f` (Royal rebrand + full customer UX redesign), `029ee3a` (demo order seed), `d759f05` (reference-render match) | `git push -u origin feature/customer-ux` |
| **Local `main` is stale** | Local `main` = `7d8297f` (Jul 1); `origin/main` = `99f68be` (Jul 13) — 33 commits behind | `git checkout main && git pull` |
| **`feature/customer-ux` never merged** | It is the newest state of the customer app and is 3 commits ahead of `origin/main` | Merge to `main` after review |
| **13 stale branches** | All other local/remote feature branches are fully merged into `origin/main` (0 unmerged commits each) | Safe to delete |

---

## 2. What is actually built (verified)

### 2.1 Live environment — healthy right now

| Service | URL | Status (checked 2026-08-12) |
|---|---|---|
| **API** | https://api-production-d45a.up.railway.app | ✅ 200 — `postgis=3.4.3`, `timescaledb=2.26.4`, Redis `PONG` |
| **API docs (Swagger)** | https://api-production-d45a.up.railway.app/v1/docs | ✅ 200 (JSON at `/v1/docs-json`) |
| **Web console** | https://web-production-ba508.up.railway.app | ✅ 200 |

Railway project **Blue Bee** (`911958f6-42d0-4a28-9ed5-7081c53f4b8e`), environment `production`.
Four services: `postgres` (custom PostGIS + TimescaleDB image, persistent volume), `Redis`, `api`, `web`.

### 2.2 Build health — all green

Verified by running the suites on 2026-08-12:

| Package | Suites | Tests | Result |
|---|---|---|---|
| `@blue-bee/api` | 36 | 338 | ✅ pass |
| `@blue-bee/customer` | 25 | 229 | ✅ pass |
| `@blue-bee/web` | 33 | 216 | ✅ pass |
| `@blue-bee/driver` | 11 | 49 | ✅ pass |
| `@blue-bee/owner` | 8 | 30 | ✅ pass |
| `@blue-bee/api-client` | 1 | 7 | ✅ pass |
| `@blue-bee/design-tokens` | 1 | 8 | ✅ pass |
| **Total (unit)** | **115** | **977** | **✅ all pass** |
| `api` **e2e** (needs Docker) | 38 | 466 | ✅ pass (last recorded run, Inc-38) |

`npx turbo run typecheck` → **10/10 tasks pass**, TypeScript strict across all 8 packages.

> **⚠️ Critical for the new developer — run tests serially.**
> `npm test` at the repo root spawns parallel Jest workers and produces **false failures** (5s test
> timeouts) on this hardware. The same suites are 100% green with `--runInBand`. This has already been
> misdiagnosed once as a product bug (see `handoffs/2026-07-13-inc38-per-garment-booking.md` §"A note on
> two red e2e runs"). Always run:
> ```bash
> cd apps/<name> && npm test -- --runInBand
> ```

### 2.3 Backend — complete for Phase 1 + parts of Phase 2

| Layer | State |
|---|---|
| **API** | NestJS modular monolith · 38 modules · 42 controllers · **216 endpoints** · URI versioning (`/v1`) · Swagger published |
| **Database** | PostgreSQL + PostGIS + TimescaleDB · **59 Prisma models** · 50 enums · **28 migrations** (all additive, forward-only) |
| **Realtime** | Socket.IO · `/live/vehicle` (customer, short-lived signed per-vehicle token) · `/live/fleet` (owner/dispatch, JWT) |
| **Auth** | Phone-OTP + email/password + OAuth verify · JWT access + refresh with rotation & reuse detection · **9 roles** (OWNER, DISPATCHER, CSR, PLANT_OP, DRIVER, FINANCE, ACCOUNT_ADMIN, ACCOUNT_STAFF, RESIDENTIAL_CUSTOMER) |
| **Tenancy** | `org_id` on every row · server-side row-scoping (`scopedPrisma`) · immutable `AuditLog` (DB trigger) |
| **Custody** | Append-only `CustodyEvent` (DB trigger blocks UPDATE/DELETE) |

The full Phase-1 spine — **book → track → custody → deliver → bill** — is built and proven end-to-end,
plus Phase-2 work that was pulled forward: corporate/condo B2B pricing, cost-centre split billing,
care-home resident clothing + lost & found, facility linen par levels, in-app chat, geo-blocked service
zones, ratings, referrals + credits, and driver proof-of-delivery.

### 2.4 Client surfaces

| Surface | Stack | Size | State |
|---|---|---|---|
| **Web console** | Next.js 14 + Tailwind | ~16.1k LOC · 21 console pages + 2 portal pages | **Most complete.** Orders, dispatch, fleet, accounts, corporate, customers, finance, catalog, analytics, admin, service-zones, residents, facility-linen, content |
| **Customer app** | React Native + Expo | ~15.9k LOC · 14 screens | Functionally broad, **UX just redesigned** ("Royal Dry Cleaning & Laundry" rebrand). Several rows are honest "Coming soon" placeholders — see §3.2 |
| **Driver app** | React Native + Expo | ~5.4k LOC · 8 screens | Route, stop, weigh, POD (photo + signature + geo), chat, background GPS with sharing indicator |
| **Owner app** | React Native + Expo | ~4.1k LOC · 8 screens | Dashboard, fleet map, approvals, exceptions, route/order detail |

---

## 3. What's left to do

Ordered by what blocks a customer-facing launch.

### 3.1 P0 — Go-live blockers (credentials & infrastructure)

Everything here is **code-complete**; only credentials/config are missing. The seams are built and tested.

| # | Item | Current state | What to do | Risk if skipped |
|---|---|---|---|---|
| 1 | **🔴 SMS / OTP security** | `SMS_TRANSPORT=console` and `NODE_ENV=staging`, so **the API returns the OTP code in its own response** (`devCode`) | Set `SMS_TRANSPORT=twilio` + `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`, then flip `NODE_ENV=production` | **Anyone can log in as anyone.** This is a total auth bypass in public hands. Must be closed before a single real customer. |
| 2 | **AWS S3 media** | Bucket `bluebee-media-prod` (ca-central-1) **created and proven** (`npm run s3-proof` → 18/18), but the 4 vars are unset → `/v1/media/presign` errors | Set `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` on `api`. **Leave `S3_ENDPOINT` UNSET** (setting it selects MinIO) | No before/after photos, no driver POD photos/signatures, no catalog images |
| 3 | **Stripe** | No key → deterministic `LocalPaymentProvider`. **No real money moves.** Webhook path is real | Register webhook `https://api-production-d45a.up.railway.app/v1/webhooks/stripe` in Stripe **TEST** dashboard; set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`. Test mode first, live key only after a full payment rehearsal | Cannot take payment |
| 4 | **Email + Push** | SendGrid in sandbox (`SENDGRID_SANDBOX=true`), push transport `console` | `SENDGRID_API_KEY` + `SENDGRID_SANDBOX=false` + `SENDGRID_FROM_EMAIL`; `PUSH_TRANSPORT=expo` + `EXPO_ACCESS_TOKEN` | No order emails, no push notifications — the core of a tracked-job experience |
| 5 | **🔴 Google Maps Android key** | `react-native-maps` is a dependency in **all three** mobile apps, but **no `android.config.googleMaps.apiKey` in any `app.json`** | Provision a Google Maps Platform key; add to each app's `app.json` under `android.config.googleMaps.apiKey`; restrict by package name + SHA-1 | **Maps render blank on Android.** Live tracking is the marquee feature — this breaks it on half the fleet's phones and most customers |
| 6 | **Geocoding at scale** | Default provider is **Nominatim (OpenStreetMap)** — keyless, but OSM policy caps traffic at **~1 request/sec** (enforced in-process by `NOMINATIM_MIN_INTERVAL_MS=1100`). The Google geocoder is **not implemented** (`GEOCODER_PROVIDER=google` throws at boot) | Either self-host Nominatim and point `NOMINATIM_BASE_URL` at it, or implement the Google geocoder behind the existing seam | Address lookups throttle under real signup load |
| 7 | **Custom domain + TLS** | Running on `*.up.railway.app` | `railway domain <yourdomain>` on `api` and `web`, add the DNS records, update `CORS_ALLOWED_ORIGINS`, `NEXT_PUBLIC_API_BASE_URL`, and every app's `EXPO_PUBLIC_API_BASE_URL` | Unprofessional for customers; app store reviewers notice |
| 8 | **Deploy runbook is stale** | `docs/DEPLOY-RAILWAY.md` documents the state at commit `792f701` / 13 migrations (2026-06-27). The repo now has **28 migrations**, and live route probes confirm the API is running **at least Inc-37/38** (Jul 13) | Re-verify live migration count (`railway ssh --service api "npx prisma migrate status"`) and update the runbook | The next operator deploys against wrong assumptions |

### 3.2 P1 — Frontend completion (the main body of work)

The customer app is the weakest surface and the one facing paying customers. It follows an "honesty
firewall" — rather than faking features, unfinished rows open a **"Coming soon"** sheet. Those rows are
the to-do list, and they are visible to customers today.

#### Customer app — rows that are currently "Coming soon"

| Row / feature | Where | Backend exists? | Work required |
|---|---|---|---|
| **Payment Methods** (saved card) | `SettingsScreen` | ❌ **No** — no `SetupIntent`, no `PaymentMethod` model | Backend: Stripe SetupIntent + tokenized card storage. App: manage-cards screen. *(PRD A1.2, MVP)* |
| **Notifications** (per-channel prefs) | `SettingsScreen`, `OrdersScreen` | ⚠️ **Partial** — `NotificationPreference` model exists and the engine **reads** it, but there is **no write endpoint** | Backend: `GET`/`PUT /v1/account/notification-preferences`. App: prefs screen. *(PRD A6.1, MVP)* |
| **Promo codes** | `PayScreen` | ❌ No promo/voucher entity | Backend: promo entity + discount path. App: apply-code field |
| **Preferences** | `SettingsScreen` | ❌ No | Define scope first — likely folds into Notifications |
| **Repeat Pickups** | `SettingsScreen` | ⚠️ `StandingOrder` exists (B2B) | Expose a consumer-facing reorder/repeat flow over the existing standing-order engine |
| **Subscriptions** | `SettingsScreen` | ❌ Deliberately deferred (PRD §14.1 → Phase 4) | **Remove the row** or keep it honest. Do not build |
| **Buy Gift Card** | `SettingsScreen` | ❌ No stored-value model | Deferred — needs the credit ledger first |
| **Contact Store / 24/7 Support / Rate Our App** | `SettingsScreen`, `OrdersScreen` | ❌ No | Cheap wins: route Support → existing in-app chat; Rate Our App → store deep link |
| **Secure & Safe / Easy Returns** | `OrdersScreen` trust strip | ❌ No backing content | Content-only — write the policy pages |

#### Customer app — MVP features in the PRD that are not built at all

| Feature | PRD ref | State |
|---|---|---|
| **Tip at payment** | A5.1 | ❌ Not built — no tip field anywhere in schema, API, or app |
| **Saved payment method** | A1.2 | ❌ Not built |
| **Raise a claim from the app** (with photos) | A6.2 | ⚠️ `Claim` **model exists** but has **no service, no controller, no write path, no UI**. The app renders claim *states* only |
| **Apple / Google sign-in** | A1.1 | ⚠️ Backend `POST /v1/auth/oauth` is built and verifies ID tokens. **On-device acquisition is not implemented** — `apps/customer/src/auth/oauth-native.ts` throws `OAuthUnavailableError`. Needs `expo-apple-authentication` + `expo-auth-session` + client IDs |
| **Map-pin address picker** | A1.2 | ❌ Deliberately not built — blocked on the same Google Maps Android key (item 5 above) |

#### Driver & owner apps

| Item | State | Action |
|---|---|---|
| **🔴 `eas.json` production profile** | `apps/driver` and `apps/owner` **production profiles have no `EXPO_PUBLIC_API_BASE_URL`** → production builds fall back to **`http://localhost:3000`** | Add the env block. This exact bug was already found and fixed for `apps/customer` in commit `f2c52b9` — it was **never applied to the other two apps**. A production driver build today cannot reach the API |
| **Owner app EAS setup** | No `extra.eas.projectId`, `updates: false` | Run `eas init` for the owner app before any build/OTA |
| **App versions** | All three apps sit at `version: 0.1.0` | Set real versions before submission |

#### Web console

| Item | State |
|---|---|
| Coverage | Broadest surface — 21 console pages against PRD §7B. No known functional gaps flagged |
| **Refresh token in `localStorage`** | Documented XSS exposure (`apps/web/lib/token-store.ts`). httpOnly-cookie hardening is an **open, deliberately deferred follow-up** from Inc-13 |

### 3.3 P2 — Security & operational hardening (explicitly deferred so far)

The Railway environment is described in its own runbook as *"a reachable pilot, not a hardened
production."* Before real customers:

1. **Security review / penetration test** — never done; explicitly out of scope in the Inc-14b prompt.
2. **Load test** — never done. No known concurrency ceiling.
3. **Console token hardening** — move the refresh token to an httpOnly cookie.
4. **Error tracking + APM** — `SENTRY_DSN` and `OTEL_EXPORTER_OTLP_ENDPOINT` exist in `.env.example` but are unset. **There is no production error visibility today.**
5. **Backups** — verify Railway volume backup/restore and actually rehearse a restore.
6. **API replica count** — must stay at **1** (the boot runs `prisma migrate deploy`; two replicas race the migrator). Revisit before scaling.
7. **Rate limiting** — OTP endpoints are rate-limited; the broader API is not audited for it.
8. **Legal/compliance** — see `docs/COMPLIANCE.md`. Privacy policy, terms, and PIPEDA posture need review before a public launch (location tracking + resident data raise the bar).

### 3.4 P3 — App store submission (not started)

Neither app has been submitted. Required for each of the three apps:

- Apple Developer + Google Play Console enrolment (~$99/yr + $25 one-time)
- App icons, splash screens, screenshots at every required size
- Privacy policy URL + App Store privacy nutrition labels (`PrivacyInfo.xcprivacy` files exist — good start)
- **Background location justification** — the driver app uses `expo-location` + `expo-task-manager` for
  background GPS. Both stores scrutinise this heavily; prepare the justification and a demo video
- Sign in with Apple **is mandatory** if Google sign-in ships (see §3.2)
- `eas submit` pipeline configuration

### 3.5 Deliberately NOT built (Phase 2/3 — do not "fix" these)

Per PRD §14.1, these are unbuilt **by design** and modelled-for but never faked. The enums and columns
exist so Phase 2/3 is additive rather than a rewrite:

RFID linen pooling · full plant/production module (rewash/reject/reclaim/discard workflow) · consumer
wash-&-fold subscription · machine-booking (Phase 4) · marketplace / multi-operator / multi-city ·
WhatsApp channel · French localization · DB-backed editable notification templates.

---

## 4. API reference

**Base URL:** `https://api-production-d45a.up.railway.app`
**Prefix:** `/v1` (URI versioning) · **Auth:** `Authorization: Bearer <accessToken>` · **Errors:** problem+json
**Interactive docs:** `/v1/docs` · **OpenAPI JSON:** `/v1/docs-json` ← *generate the typed client from this*

216 endpoints across 42 controllers. Grouped below by domain.

> **Note on `:` in paths** — some action routes use a colon verb suffix, e.g.
> `POST /v1/orders/:id/quote:approve` and `POST /v1/route-stops/:id:complete`. That is intentional
> (RFC-style action sub-resources), not a typo.

### Auth & identity

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/otp` | Request a phone OTP |
| POST | `/v1/auth/verify` | Verify OTP → access + refresh tokens |
| POST | `/v1/auth/register` | Email/password registration |
| POST | `/v1/auth/login` | Email/password login |
| POST | `/v1/auth/refresh` | Rotate refresh token (reuse detection) |
| POST | `/v1/auth/logout` | Revoke session |
| POST | `/v1/auth/email/verify` | Confirm email address |
| POST | `/v1/auth/password/reset` · `/confirm` | Password reset flow |
| POST | `/v1/auth/oauth` | Verify an Apple/Google ID token → session |
| GET | `/v1/auth/methods` | List the caller's linked sign-in methods |
| POST | `/v1/auth/password` | Set/change password |
| DELETE | `/v1/auth/methods/:provider` | Unlink a sign-in method |
| GET | `/v1/me` | Current user + roles |

### Account & profile

| Method | Path | Purpose |
|---|---|---|
| PATCH | `/v1/account/profile` | Update name/email |
| DELETE | `/v1/account` | Account deletion (PIPEDA/store requirement) |
| GET | `/v1/account/referral` · `/referrals` | Referral code + referred-user list |
| GET | `/v1/account/credits` | Credit balance + ledger |

### Catalog & content

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/services` · `/v1/sites` | Bookable services; caller's sites |
| GET | `/v1/catalog/home` | Home service cards (incl. `garmentCount` → drives the per-garment flow) |
| GET | `/v1/catalog/dryclean?cardId=` | Per-garment picker, scoped to one card |
| GET | `/v1/home` | Home screen blocks |
| GET/POST | `/v1/catalog/categories` · PATCH `/:id` | Category admin |
| GET | `/v1/catalog/service-menu` · PATCH `/:id` | Service-menu admin |
| GET | `/v1/catalog/admin` | Full admin catalog view |
| POST | `/v1/catalog/items` · PATCH `/:id` · PATCH `/v1/catalog/reorder` | Item admin + drag-to-reorder |
| POST | `/v1/catalog/image/presign` | Catalog image upload |
| GET/POST | `/v1/admin/home-blocks` · PATCH/DELETE `/:id` | Home-screen content blocks |

### Orders — lifecycle (PRD §5.1 state machine)

`REQUESTED → SCHEDULED_PICKUP → PICKUP_EN_ROUTE → PICKED_UP → INTAKE_INSPECTED → QUOTED → QUOTE_APPROVED → IN_CLEANING → QC → READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED → INVOICED → CLOSED`
Branches: `QUOTE_DECLINED` · `CLOSED_NO_WORK` · `DAMAGE_PREEXISTING_FLAGGED` · `ON_HOLD` · `REWASH` · `CLAIM_OPENED` · `CLAIM_RESOLVED`

| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/v1/orders` · GET `/:id` | Create / list (cursor paginated) / read |
| POST | `/v1/orders/:id/schedule-pickup` | Assign a pickup window |
| POST | `/v1/orders/:id/received-at-plant` | Intake |
| POST | `/v1/orders/:id/items/:itemId/inspection` | Inspect + measure + damage flag |
| POST | `/v1/orders/:id/quote` | Build & send the quote |
| POST | `/v1/orders/:id/quote:approve` · `:decline` | Customer decision |
| POST | `/v1/orders/:id/start-cleaning` · `/send-to-qc` · `/qc` · `/rewash` | Production transitions |
| POST | `/v1/orders/:id/weigh` · GET `/weight` | Weight capture (kg → lb at pricing) |
| POST | `/v1/orders/:id/hold` · `/resume` | Hold / resume |
| GET | `/v1/orders/:id/tracking` | Tracking state + channel token mint |
| GET | `/v1/availability/pickup-slots` | Bookable pickup windows |

### Ratings, chat, cost centres

| Method | Path | Purpose |
|---|---|---|
| POST/PATCH/GET | `/v1/orders/:id/rating` | CSAT after `DELIVERED` |
| GET | `/v1/orders/:id/messages` · `/unread` · `/channel` | In-app chat thread |
| POST | `/v1/orders/:id/messages` · `/messages/read` | Send / mark read |
| PUT | `/v1/orders/:id/cost-center` | Assign an order to a cost centre |

### Logistics, dispatch & fleet

| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/v1/vehicles` · GET/PATCH `/:id` | Vehicle management |
| POST/GET | `/v1/drivers` · GET `/:id` | Driver management |
| POST/GET | `/v1/shifts` · GET `/:id` · POST `/:id:start` · `/:id:end` | Shifts (gate GPS emission) |
| POST/GET | `/v1/routes` · GET `/:id` | Route CRUD |
| POST | `/v1/routes/:id/stops` · `/assign` · `/optimize` · `/publish` · `/manifest` | Build → optimize → publish |
| GET | `/v1/route-stops` · `/:id` · `/:id/manifest` | Stop reads |
| POST | `/v1/route-stops/:id/manifest` · PATCH `/:id` | Stop updates |
| POST | `/v1/route-stops/:id:depart` `:arrive` `:start` `:complete` `:fail` `:skip` | §5.4 stop state machine (dispatcher side) |

### Driver app

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/driver/assignment` | Today's route + stops |
| POST | `/v1/driver/shifts/:id/start` · `/end` | Duty cycle (gates location sharing) |
| POST | `/v1/driver/stops/:id/depart` `/arrive` `/start` `/complete` `/fail` `/skip` | Stop transitions — **authoritative over raw GPS** |
| POST | `/v1/driver/stops/:id/pod/presign` | Presign a POD upload |
| POST/GET | `/v1/driver/stops/:id/proof-of-delivery` | POD: photo + signature + geo |
| POST | `/v1/driver/stops/:id/weigh` · GET `/weight` | At-stop weight capture |
| POST | `/v1/driver/stops/:stopId/soil-pickup` | Facility soil pickup |

### Tracking & realtime

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/locations:batch` | Batched GPS ingest (offline queue drain) |
| GET | `/v1/fleet/live` | Last-known position of every org vehicle |
| GET | `/v1/orders/:id/tracking` | Customer tracking state + signed channel token |
| **WS** | `/live/vehicle` | Customer channel — `auth.token` = short-lived channel token, server-bound to **one** vehicle |
| **WS** | `/live/fleet` | Owner/dispatch channel — `auth.token` = access JWT, bound to the org fleet room |

WS server→client events: `position`, `eta`, `geofence` (`APPROACHING` / `ARRIVED`). Clients never emit — subscription is server-bound.

### Payments, invoices & finance

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/orders/:id/payment-intent` · GET `/payment` | Order payment |
| POST | `/v1/orders/:id/invoice` · GET `/invoice` | Order invoice |
| POST | `/v1/invoices/:id/payment-intent` · GET `/payment` | Invoice payment |
| GET | `/v1/invoices` · `/:id` · `/:id/statement.pdf` | Invoice list / detail / PDF |
| POST | `/v1/payments/:id/refund` · GET `/v1/disputes` | Refunds & disputes |
| **POST** | **`/v1/webhooks/stripe`** | **Stripe webhook — register this URL in the Stripe dashboard** |

### B2B accounts, corporate & recurring

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/accounts` · `/:accountId` | Account list / detail |
| GET | `/v1/accounts/:accountId/orders` · `/manifests` · `/exceptions` | B2B self-serve portal |
| GET/PUT | `/v1/accounts/:accountId/billing-terms` | Billing terms |
| POST | `/v1/accounts/:accountId/invoices/batch` · GET `/generated` | Batch invoicing |
| POST/GET | `/v1/accounts/:accountId/cost-centers` · GET `/report` · `/report.csv` | Cost-centre split billing |
| PATCH | `/v1/cost-centers/:id` | Update a cost centre |
| POST/GET | `/v1/corporate/accounts` · GET/PATCH `/:accountId` | Corporate accounts |
| GET/POST | `/v1/corporate/accounts/:accountId/buildings` · PATCH `/v1/corporate/buildings/:siteId` | Condo/building hierarchy |
| GET | `/v1/corporate/accounts/:accountId/rate-card` · PUT `/items/:serviceId` | Per-account rate cards |
| POST | `/v1/corporate/accounts/:accountId/join-code` · `/v1/corporate/redeem` · GET `/memberships` | Resident join-code flow |
| POST/GET | `/v1/standing-orders` · `/run` · GET `/:id` · `/:id/occurrences` · PATCH · DELETE | Recurring orders |

### Facility linen & residents (care homes / hotels)

| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/v1/sites/:siteId/par-levels` · PATCH `/v1/par-levels/:id` | Par levels |
| GET | `/v1/sites/:siteId/linen-stock` · POST `/adjust` | Linen stock |
| POST/GET | `/v1/sites/:siteId/soil-pickups` | Soil pickups |
| GET/POST | `/v1/sites/:siteId/pack-to-par` · GET `/manifests` | Pack-to-par load sheets |
| POST/GET | `/v1/residents` · GET `/:residentId` · `/clothing` · POST `/garments` | Resident clothing |
| POST | `/v1/garments/:garmentId/transition` · `/lost-found` | Garment lifecycle |
| GET | `/v1/lost-found` · `/report` · POST `/:lostFoundId/reconcile` | Lost & found |

### Sites, service zones & media

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/sites` · PATCH `/:id` · POST `/:id:deactivate` | Saved addresses (geocoded) |
| GET/POST | `/v1/service-zones` · GET/PATCH `/:zoneId` | Drawn service zones (geo-blocking) |
| GET | `/v1/coverage-requests` | Out-of-zone demand capture |
| POST | `/v1/media/presign` · `/v1/media/confirm` | Presigned upload → confirm → signed read |
| POST/DELETE | `/v1/device-tokens` | Push token registration |

### Owner app, analytics & admin

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/owner/today` · `/approvals` · `/exceptions` | Owner dashboard |
| GET | `/v1/analytics/operational` · `/commercial` · `/accounts/:accountId/scorecard` | Dashboards |
| GET | `/v1/admin/users` · POST `/users/:userId/roles` · DELETE `/roles/:roleId` | Users & roles |
| GET/POST | `/v1/admin/devices` · DELETE `/:id` | Device registry |
| GET | `/v1/admin/drivers` · PATCH `/:driverId` | Driver → vehicle assignment |
| GET/PATCH | `/v1/admin/settings/schedule` | Operating schedule |
| GET | `/v1/admin/notification-config` | Read-only event→channel matrix |
| GET | `/v1/admin/audit-logs` | Immutable audit trail |
| GET | `/v1/admin/customers` · `/:id` | Customer 360 |
| GET/PUT | `/v1/admin/referral-reward` | Referral reward amount |
| GET/POST | `/v1/admin/customers/:id/credits` · `/credits/adjust` | Manual credit adjustment |
| GET | `/v1/health` | Liveness: DB + PostGIS + TimescaleDB + Redis |

---

## 5. Environment variables

Values live **only on Railway** — never in git. Full template: `.env.example`. Full runbook: `docs/DEPLOY-RAILWAY.md`.

### Currently set on the `api` service

`NODE_ENV=staging` · `PORT` (Railway) · `TRUST_PROXY=1` · `DATABASE_URL` · `REDIS_URL` ·
`REDIS_FAMILY=0` · `JWT_ACCESS_SECRET` · `JWT_REFRESH_SECRET` · `OTP_PEPPER` ·
`CHANNEL_TOKEN_SECRET` · `SMS_TRANSPORT=console` · `NOTIF_RETRY_SCAN_MS=3000` ·
`CORS_ALLOWED_ORIGINS` · `RAILWAY_DOCKERFILE_PATH`

### Must be set before customer launch

```bash
# ── 1. SMS (CLOSES THE OTP BYPASS — do this first) ──
SMS_TRANSPORT=twilio
TWILIO_ACCOUNT_SID=<...>
TWILIO_AUTH_TOKEN=<...>
TWILIO_FROM_NUMBER=<...>
NODE_ENV=production            # flip ONLY after Twilio works — the guard forbids console SMS in production

# ── 2. S3 media (bucket already exists and is proven) ──
AWS_REGION=ca-central-1
S3_BUCKET=bluebee-media-prod
AWS_ACCESS_KEY_ID=<...>
AWS_SECRET_ACCESS_KEY=<...>
# leave S3_ENDPOINT UNSET (setting it selects MinIO); leave MEDIA_ENSURE_BUCKET unset

# ── 3. Stripe (TEST mode first) ──
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ── 4. Email + push ──
SENDGRID_API_KEY=<...>
SENDGRID_SANDBOX=false
SENDGRID_FROM_EMAIL=<...>
PUSH_TRANSPORT=expo
EXPO_ACCESS_TOKEN=<...>

# ── 5. Observability (nothing exists today) ──
SENTRY_DSN=<...>
```

### Mobile apps (`eas.json` per app)

`EXPO_PUBLIC_API_BASE_URL` — **currently missing from the `production` profile of `apps/driver` and
`apps/owner`** (see §3.2). Plus the Stripe publishable key for the customer app, and the Google Maps
Android key in each `app.json`.

### Accounts to provision / transfer at handover

| Service | Purpose | Status |
|---|---|---|
| **Railway** | Hosting (API, web, Postgres, Redis) | ✅ Live — transfer project access |
| **GitHub** (`onskim/blue-bee`) | Source | ✅ Exists — grant access |
| **AWS** | S3 media bucket + IAM user | ⚠️ Bucket exists; IAM key not deployed |
| **Stripe** | Payments | ❌ Not connected |
| **Twilio** | SMS / OTP | ❌ Not connected |
| **SendGrid** | Email | ❌ Not connected |
| **Google Cloud** | Maps Platform (Android maps + optional geocoding) | ❌ Not provisioned |
| **Expo / EAS** | Mobile builds + push | ⚠️ customer + driver have project IDs; **owner does not** |
| **Apple Developer** | iOS distribution | ❌ Not enrolled |
| **Google Play Console** | Android distribution | ❌ Not enrolled |

---

## 6. Running it

### Local development

```bash
cd "/Volumes/Gowtham/Blue Bee"
nvm use 20
npm install
cp .env.example .env          # fill in secrets
npm run infra:up              # Docker: Postgres(PostGIS+Timescale) + Redis + MinIO
cd apps/api && npx prisma migrate deploy && npm run db:seed
cd ../.. && npm run dev       # Turborepo: all apps
```

Useful scripts: `npm run build` · `npm run lint` · `npm run typecheck` · `npm run infra:down`
API-specific: `npm run db:seed:catalog` · `db:seed:demo` · `db:bootstrap` · `db:studio` · `s3-proof`

### Tests

```bash
cd apps/api && npm test -- --runInBand          # 338 unit
cd apps/api && npm run test:e2e                 # 466 e2e — needs infra:up + seeded DB
cd apps/customer && npm test -- --runInBand     # 229
cd apps/web && npm test -- --runInBand          # 216
```

**Always `--runInBand`.** See the warning in §2.2.

### Mobile dev loop (don't rebuild for every change)

```bash
cd "/Volumes/Gowtham/Blue Bee/apps/customer" && nvm use 20
eas build --profile development --platform android      # once, ~1–2 hrs → install on phone
EXPO_PUBLIC_API_BASE_URL=https://api-production-d45a.up.railway.app npx expo start --dev-client --tunnel
```

Every save hot-reloads on the device against the live API in ~1s. Only build a `preview`/`production`
APK at the very end.

### Deploy

```bash
# from a clean checkout of the commit you want live:
railway up --project 911958f6-42d0-4a28-9ed5-7081c53f4b8e --environment production --service api --ci
railway up --project 911958f6-42d0-4a28-9ed5-7081c53f4b8e --environment production --service web --ci
```

- `railway up` uploads the **current working directory**, not a git ref — deploy from the tree you want live.
- **Never redeploy `postgres`** unless `infra/Dockerfile.postgres` changed. The volume and data persist across api/web redeploys.
- Migrations run automatically on API boot (`prisma migrate deploy` — forward-only, never destructive).
- **Keep the API at one replica** so two boots never race the migrator.

---

## 7. Gotchas the next developer will otherwise rediscover

1. **Parallel Jest gives false failures.** Always `--runInBand`. Already misdiagnosed once.
2. **Railway private networking is IPv6-only.** Postgres needs `listen_addresses=*`; ioredis needs `REDIS_FAMILY=0`.
3. **`PGDATA` must be a *subdirectory* of the volume mount** — a fresh Railway volume contains `lost+found` and `initdb` refuses a non-empty dir.
4. **`railway volume add --service X` panics** (CLI bug). Workaround: `railway service link X` first, then `railway volume add --mount-path ...` with no `--service` flag.
5. **`NEXT_PUBLIC_API_BASE_URL` is baked at Docker build time** for the web console — changing it requires a rebuild, not a restart.
6. **`EXPO_PUBLIC_API_BASE_URL` is baked into the OTA bundle.** It has silently fallen back to `localhost` on this project before. Fire `eas update` deliberately with the env set, or not at all.
7. **The repo lives on an external APFS drive and the parent folder name contains a space** (`Blue Bee`). Quote every path in scripts. npm workspaces (not pnpm) was chosen specifically to avoid symlink issues here.
8. **Custody events and audit logs are append-only at the database level** (triggers block UPDATE/DELETE). Don't fight it — it is the product.
9. **`prisma/seed.ts` is demo-only and forbidden in production.** The prod path is the idempotent `prisma/bootstrap.ts` (one org + one owner). Re-running it with a *different* phone refuses rather than creating a second org.
10. **The pilot owner `+14165550100` still exists in production** with email `onskim2@gmail.com`. Re-target the org in place and remove that owner before real customers.

---

## 8. Document map

| File | What it is |
|---|---|
| `docs/laundry-platform-PRD.md` | **The authoritative spec** (v1.0, ~690 lines). Read first |
| `CLAUDE.md` | Build guide, conventions, house rules, non-negotiables |
| `ARCHITECTURE.md` | System architecture |
| `BUILD-PLAN.md` | Phase-1 increment checklist |
| `docs/MVP-CUTLINE.md` | Phase-1 completion reconciliation + what is deferred by design |
| `docs/DEPLOY-RAILWAY.md` | Deployment runbook — **⚠️ stale, see §3.1 item 8** |
| `docs/COMPLIANCE.md` | Compliance posture |
| `docs/customer-app-feature-analysis-2026-07-09.md` | Competitive analysis (Laundryheap/Poplin) + gap list. **Partly outdated** — addresses, ratings, referrals, onboarding, pricing have shipped since |
| `docs/design/DESIGN-LANGUAGE.md` | Design tokens & language |
| `apps/customer/UX-REDESIGN-BRIEF.md` | The frozen frontend↔backend contract. **Read before touching the customer app** |
| `apps/customer/DESIGNER-ONBOARDING.md` | Designer onboarding — token→primitive→screen seam |
| `apps/owner/AS-BUILT-MAP.md` | Owner app as-built |
| `CHANGELOG.md` | 358 KB running build log, newest on top |
| `handoffs/` | 82 dated handoff docs — newest is latest |
| `blue-bee-reference-customer/` | The founder's reference renders for the customer app |

---

## 9. Suggested sequence for the incoming developer

**Week 1 — take control, close the security hole**
1. Push `feature/customer-ux`; update local `main`; merge and delete stale branches.
2. Get Railway, GitHub, AWS access transferred.
3. **Wire Twilio and flip `NODE_ENV=production`** — this closes the OTP bypass. Nothing else matters until this is done.
4. Set the S3 vars (bucket is already created and proven) → photos and POD start working.
5. Read the PRD, `CLAUDE.md`, and `apps/customer/UX-REDESIGN-BRIEF.md`.

**Week 2 — make it transactable**
6. Stripe test mode end-to-end, then a live-key rehearsal.
7. SendGrid + Expo push out of sandbox.
8. Add `SENTRY_DSN` — you cannot operate blind.
9. Fix the `eas.json` production profiles for driver and owner; run `eas init` for owner.

**Weeks 3–5 — close the frontend**
10. Google Maps Android key → maps work on Android across all three apps.
11. Build the real screens behind the "Coming soon" rows, highest value first: **Notification preferences** (backend is 80% there — just needs a write endpoint) → **Saved payment methods** → **Tip at payment** → **Claim from app** (model exists, needs service + controller + UI).
12. Decide and remove the rows you will not build (Subscriptions, Gift Cards) rather than leaving them visible.
13. Wire Apple/Google sign-in on-device.

**Week 6+ — launch readiness**
14. Security review + load test.
15. Console httpOnly-cookie hardening.
16. Custom domain.
17. Store enrolment, assets, submission.

---

*Prepared 2026-08-12 from a live audit. Every claim was verified against the code, the git history, the
test suites, or the running environment. Where something is unbuilt or uncertain, this document says so.*
