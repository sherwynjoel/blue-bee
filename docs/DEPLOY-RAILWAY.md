# Blue Bee — Railway deploy runbook (Increment 14b · refreshed to `main` `792f701` on 2026‑06‑27)

**Working folder:** `/Volumes/Gowtham/Blue Bee` · **Stack target:** PRD §10.2 infra.

This is the **operational runbook** for the live Phase‑1 pilot environment on Railway. It describes
every service, every environment variable (names only — **values live only on Railway, never in git**), the
migration + real‑org bootstrap plan, the founder's manual steps, and rollback.

> **2026‑06‑27 verification refresh (commit `792f701`).** The live pilot was redeployed from the stale
> Inc‑14b state (**9 migrations**) to current `main` — **now 13 migrations**. New since 14b and **now live**:
> Track‑A recurring/condo‑B2B (portal Orders/Manifests/Exceptions), Track‑B resident clothing + lost&found,
> cost‑centre split‑billing (**backend + web console UI**), the **Daylight reskin** (web + apps), and driver
> **proof‑of‑delivery**. Process: a headless Phase‑A gate (built the 3 prod images from current `main`; proved
> the full 13‑migration chain on a fresh prod Postgres AND a **9→13 upgrade on a persistent volume with data
> preserved**; smoke + the reskinned web bundle) → `railway up --service api` then `--service web` (single
> `api` replica; **postgres image unchanged so the volume + bootstrapped owner persisted**) → live smoke (13
> migrations, the pilot owner `+14165550100` still logs in, the cost‑centre + POD routes respond/authorize,
> the console serves the reskin). **No Dockerfile/`.dockerignore`/`.railwayignore` change was needed** — the
> existing images build current `main` as‑is (the new `@blue-bee/design-tokens` workspace package is wired but
> **not imported by `apps/web`**, which still mirrors tokens locally, so the web image is unaffected; `lucide-react`
> is an ordinary npm dep `npm ci` already resolves). **Still parked** for the pilot (unchanged): media/S3 (**c**)
> — so `/v1/media/presign` **and the new POD photo/signature uploads** error until the founder sets S3; real
> SMS/email/push (**a**); live Stripe test‑mode (**d**). The refreshed smoke transcript is in §3.

> **Pilot posture.** This is a reachable pilot, not a hardened production. The deliberate, documented choices are
> called out under **Decisions** below (NODE_ENV=staging SMS allowance, no demo seed, private DB networking,
> `*.up.railway.app` TLS). The pre‑go‑live security/pen‑test + load test, the httpOnly‑cookie console hardening,
> and a custom domain are explicitly out of scope (Inc‑14b prompt).

---

## 1. Live environment (as deployed)

| | |
|---|---|
| Railway project | **Blue Bee** (`911958f6-42d0-4a28-9ed5-7081c53f4b8e`), environment `production` |
| **API (live)** | **https://api-production-d45a.up.railway.app** — `/v1/health`, `/v1/docs` |
| **Web console (live)** | **https://web-production-ba508.up.railway.app** |
| Stripe webhook URL (public) | `https://api-production-d45a.up.railway.app/v1/webhooks/stripe` (register in Stripe **TEST** dashboard) |

### Services
1. **`postgres`** — custom image from `infra/Dockerfile.postgres` (Postgres 16 + **PostGIS 3.4.3** + **TimescaleDB 2.26.4**).
   - Persistent **volume** `postgres-volume` mounted at `/var/lib/postgresql/data`.
   - **`PGDATA=/var/lib/postgresql/data/pgdata`** — a *subdirectory* of the mount, because a fresh Railway volume
     contains a `lost+found` dir and `initdb` refuses a non‑empty data dir. This is the standard fix; do not remove it.
   - Image `CMD` preloads TimescaleDB + binds all interfaces: `postgres -c shared_preload_libraries=timescaledb -c listen_addresses=*`
     (`listen_addresses=*` is required for Railway's **IPv6‑only** private network).
   - Reachable only on the **private** network: `postgres.railway.internal:5432` (no public proxy — kept private).
2. **`Redis`** — Railway managed Redis (`redis:8.2.1`), volume at `/data`. Private host `redis.railway.internal:6379`.
3. **`api`** — `apps/api/Dockerfile` (NestJS modular monolith). Public HTTPS domain (above). Listens on Railway's `PORT`.
4. **`web`** — `apps/web/Dockerfile` (Next.js 14 console). Public HTTPS domain (above).

---

## 2. Environment variables (names only — set on Railway, **never committed**)

### `api` service
| Name | Purpose / value shape |
|---|---|
| `NODE_ENV` | `staging` (pilot — see Decisions; the Inc‑2 SMS guard still forbids console SMS only when `=production`) |
| `PORT` | injected by Railway; `main.ts` reads `PORT ?? API_PORT ?? 3000` and binds `0.0.0.0` |
| `TRUST_PROXY` | `1` (behind Railway's proxy → real client IP for per‑IP OTP limits) |
| `DATABASE_URL` | `postgresql://bluebee:${{postgres.POSTGRES_PASSWORD}}@postgres.railway.internal:5432/bluebee?sslmode=disable` (Railway **reference** — resolves the password cross‑service; `sslmode=disable` is fine on the private net) |
| `REDIS_URL` | `redis://default:${{Redis.REDIS_PASSWORD}}@redis.railway.internal:6379` (reference) |
| `REDIS_FAMILY` | `0` — forces ioredis dual‑stack DNS so it can reach the **IPv6** private host (unset locally) |
| `JWT_ACCESS_SECRET` | strong secret (≥32; generated `openssl rand -hex 32`, set via `--stdin`) |
| `JWT_REFRESH_SECRET` | strong secret (≥32) |
| `OTP_PEPPER` | strong secret (≥32) |
| `CHANNEL_TOKEN_SECRET` | strong secret (≥32) — the WS tracking‑token secret (distinct from the JWT secrets) |
| `SMS_TRANSPORT` | `console` (pilot; OTP `devCode` is returned because `NODE_ENV≠production`) |
| `NOTIF_RETRY_SCAN_MS` | `3000` (prod outbox drains in the background) |
| `CORS_ALLOWED_ORIGINS` | `https://web-production-ba508.up.railway.app` (CSV; the console origin) |
| `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` |

**Defaulted (not set) and intentionally left at code defaults:** `TAX_RATE_HST` (0.13), all OTP rate tunables,
the media/S3 vars (→ real‑S3‑no‑creds, parked **c**), the Stripe vars (→ `LocalPaymentProvider`, parked **d**),
the notification provider creds (→ SendGrid‑sandbox + console push, parked **a**).

### `web` service
| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://api-production-d45a.up.railway.app` — **inlined at build time** (Railway exposes service vars as Docker build ARGs; `apps/web/Dockerfile` declares `ARG NEXT_PUBLIC_API_BASE_URL`). Verified baked into the served bundle. |
| `PORT` | injected by Railway; `next start -p $PORT -H 0.0.0.0` |
| `RAILWAY_DOCKERFILE_PATH` | `apps/web/Dockerfile` |

### `postgres` service
`POSTGRES_USER=bluebee` · `POSTGRES_DB=bluebee` · `POSTGRES_PASSWORD` (generated, `--stdin`) ·
`PGDATA=/var/lib/postgresql/data/pgdata` · `RAILWAY_DOCKERFILE_PATH=infra/Dockerfile.postgres`.

---

## 3. Migrations + real‑org bootstrap

### Migrations (automatic, on every API boot)
The API container's start command runs **`prisma migrate deploy`** (bounded retry for the ~1–3 s private‑network
warm‑up) before booting. As of the 2026‑06‑27 refresh, **13 migrations** are applied to the Railway Postgres
(verified `railway ssh --service api "npx prisma migrate status"` → *"13 migrations found … Database schema is
up to date!"*; `postgis 3.4.3`, `timescaledb 2.26.4`). `migrate deploy` is forward‑only and **never destructive**;
the 4 migrations added since 14b (`…_track_a_recurring_condo_b2b`, `…_track_a_qc_followup_index`,
`…_track_b_resident_clothing`, `…_cost_centers`) are **purely additive** (CREATE TABLE/TYPE + nullable ADD COLUMN
+ SET‑NULL FKs + indexes; no DROP, no NOT‑NULL‑without‑default), so the **9→13 upgrade applied on the existing
persistent volume with zero data loss** (pre‑flight‑proven, then confirmed live: the bootstrapped owner survived).
**Keep the API at a single replica** so two boots never race the migrator.

### Bootstrap — the minimal real org (NOT the demo seed)
The demo `prisma/seed.ts` is **forbidden in production** (it inserts a fabricated demo order/account/tags). Instead,
`prisma/bootstrap.ts` provisions only the irreducible real‑org root: **one Organization + one owner User (phone‑OTP) +
the OWNER role**. Every field is founder‑supplied (nothing fabricated). It is **create‑once**: a re‑run with the SAME
phone is a no‑op, and it **refuses to create a second org** if one already exists (the single‑tenant pilot invariant).
Run it **inside the API container** (DB stays private):

```bash
railway ssh --service api \
  "BOOTSTRAP_ORG_NAME='<real client org name>' \
   BOOTSTRAP_OWNER_NAME='<owner name>' \
   BOOTSTRAP_OWNER_EMAIL='<owner email>' \
   BOOTSTRAP_OWNER_PHONE='+1416XXXXXXX' \
   npx ts-node --compiler-options '{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}' prisma/bootstrap.ts"
```

A pilot anchor org + owner is already bootstrapped (owner phone `+14165550100`, OWNER, email `onskim2@gmail.com`,
org labelled *"Blue Bee Pilot — anchor org (rename to the real client)"*). To **re‑target the pilot to the real client**,
**update the existing org/owner in place** (rename the org, set the owner's real name/phone/email — e.g. `railway connect`
to the DB, or a small one‑off `prisma` script) — and **suspend/remove the pilot owner** so `+14165550100` can no longer log
in. Re‑running `bootstrap.ts` with a *different* phone will **refuse** (it won't create a second org).

### Live smoke test (proven — refreshed 2026‑06‑27 against `792f701`)
```bash
API=https://api-production-d45a.up.railway.app
curl -s $API/v1/health            # → 200 {database up postgis=3.4.3 timescaledb=2.26.4, redis PONG}
# OTP login (devCode returned because NODE_ENV=staging):
curl -s -X POST $API/v1/auth/otp    -H 'content-type: application/json' -d '{"phone":"+14165550100"}'
curl -s -X POST $API/v1/auth/verify -H 'content-type: application/json' -d '{"phone":"+14165550100","code":"<devCode>"}'
curl -s $API/v1/me -H "authorization: Bearer <accessToken>"   # → "Pilot Owner" + OWNER role (survived 9→13)
# the now-live surfaces respond + authorize (owner token):
curl -s $API/v1/accounts -H "authorization: Bearer <tok>"                                  # → 200 (Track-A B2B)
curl -s $API/v1/accounts/<uuid>/cost-centers -H "authorization: Bearer <tok>"              # → 404 cost_centers.account_not_found (route+authz live)
curl -s $API/v1/driver/stops/<uuid>/proof-of-delivery -H "authorization: Bearer <tok>"     # → 403 forbidden_role (POD route live, role-gated)
# console: https://web-production-ba508.up.railway.app serves the Daylight reskin (CSS exposes --canvas/--primary tokens + .dark)
```

---

## 4. Deploy / redeploy (reproduce from scratch)

```bash
cd "/Volumes/Gowtham/Blue Bee"
railway init --name "Blue Bee"                          # creates project + production env

# Redis (managed)
railway add --database redis

# Postgres (custom PostGIS+Timescale)
railway add --service postgres \
  --variables POSTGRES_USER=bluebee --variables POSTGRES_DB=bluebee \
  --variables RAILWAY_DOCKERFILE_PATH=infra/Dockerfile.postgres
printf '%s' "$(openssl rand -hex 24)" | railway variable set POSTGRES_PASSWORD --stdin --service postgres --skip-deploys
railway up --service postgres --ci                      # build + deploy the image
railway service link postgres                           # then add the volume WITHOUT the --service flag (CLI bug workaround):
railway volume add --mount-path /var/lib/postgresql/data
railway variable set PGDATA=/var/lib/postgresql/data/pgdata --service postgres   # subdir → avoids lost+found initdb error

# API
railway add --service api \
  --variables NODE_ENV=staging --variables TRUST_PROXY=1 --variables SMS_TRANSPORT=console \
  --variables NOTIF_RETRY_SCAN_MS=3000 --variables REDIS_FAMILY=0 \
  --variables RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile \
  --variables 'DATABASE_URL=postgresql://bluebee:${{postgres.POSTGRES_PASSWORD}}@postgres.railway.internal:5432/bluebee?sslmode=disable' \
  --variables 'REDIS_URL=redis://default:${{Redis.REDIS_PASSWORD}}@redis.railway.internal:6379'
for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET OTP_PEPPER CHANNEL_TOKEN_SECRET; do
  printf '%s' "$(openssl rand -hex 32)" | railway variable set "$k" --stdin --service api --skip-deploys; done
railway up --service api --ci
railway domain --service api                            # → the public HTTPS URL

# Web console (API URL baked at build time)
railway add --service web \
  --variables RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile \
  --variables NEXT_PUBLIC_API_BASE_URL=https://<api>.up.railway.app
railway up --service web --ci
railway domain --service web                            # → the console URL
railway variable set CORS_ALLOWED_ORIGINS=https://<web>.up.railway.app --service api   # then API auto‑redeploys
```

**Notes / gotchas encountered (so the next operator doesn't relive them):**
- `railway volume add --service X` **panics** (CLI bug). Workaround: `railway service link X` first, then `railway volume add --mount-path …` (no `--service` flag). The volume also can't be added until the service has ≥1 deployment.
- Railway private networking is **IPv6‑only**: Postgres must `listen_addresses=*`; ioredis needs `REDIS_FAMILY=0`.
- A fresh volume has `lost+found` → set `PGDATA` to a **subdirectory** of the mount.
- The build context for the api/web images is the **repo root** (workspaces live above the app); `RAILWAY_DOCKERFILE_PATH` selects the Dockerfile. `.dockerignore` + `.railwayignore` keep the context/upload lean.
- `railway redeploy` replays the previous deployment's variable snapshot; to apply changed vars, set a variable **without** `--skip-deploys` (triggers a fresh deploy with current vars, no rebuild).
- **Refreshing the live env to a new commit (e.g. the 2026‑06‑27 9→13 refresh).** `railway up` uploads the
  **current working directory's** tree (honouring `.gitignore`/`.railwayignore`), so deploy from a checkout that
  IS the target commit. To redeploy without re‑linking, pass the project/service/env explicitly from that checkout:
  ```bash
  # from a clean `main` checkout (the tree you want live):
  railway up --project 911958f6-42d0-4a28-9ed5-7081c53f4b8e --environment production --service api --ci \
    --message "refresh api to <commit>"
  railway up --project 911958f6-42d0-4a28-9ed5-7081c53f4b8e --environment production --service web --ci \
    --message "refresh web to <commit>"
  ```
  **Do NOT redeploy `postgres`** unless `infra/Dockerfile.postgres` actually changed — the volume + data persist
  across `api`/`web` redeploys; the `api` boot's `migrate deploy` applies any new (additive) migrations. The
  `railway up --ci` log stream may drop with a `reqwest … operation timed out` on a long build (a CLI/IPv6 quirk) —
  the build continues; poll `railway deployment list --service api` for `SUCCESS` and re‑check `/v1/health`.

---

## 5. Founder manual steps (close the parked integrations / harden)

| Item | What to do |
|---|---|
| **SMS / true production (a)** | For real OTP SMS, set `SMS_TRANSPORT=twilio` + `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`, then flip `NODE_ENV=production`. **Until then the pilot runs `NODE_ENV=staging` with console OTP** (the Inc‑2 guard forbids console SMS only under `production`). |
| **AWS S3 (c) — bucket now CREATED + PROVEN** | The bucket **`bluebee-media-prod`** (`ca-central-1`, default **SSE‑S3/AES256**, **all public access blocked**, CORS applied) exists and the full media pipeline (generic + POD + catalog) is **proven byte‑identical against it** (`npm run s3-proof`, 18/18). **To activate prod:** set `AWS_REGION=ca-central-1`, `S3_BUCKET=bluebee-media-prod`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` on `api` (and leave `S3_ENDPOINT` **UNSET** — that selects MinIO). Keep `MEDIA_ENSURE_BUCKET` unset/false (the bucket is pre‑provisioned). Full CORS JSON + least‑privilege IAM policy in **§9**. Until the vars are set, `/v1/media/presign` errors (boot is unaffected). |
| **Stripe test (d)** | In the Stripe **TEST** dashboard, register the webhook `https://api-production-d45a.up.railway.app/v1/webhooks/stripe`; set `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_PUBLISHABLE_KEY=pk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…` on `api`. **TEST MODE ONLY — never a live key.** Until set, the API uses `LocalPaymentProvider` (deterministic, no network) + the default test webhook secret. |
| **Email/Push (a)** | `SENDGRID_API_KEY` (+ `SENDGRID_SANDBOX=false`, `SENDGRID_FROM_EMAIL`) for real email; `PUSH_TRANSPORT=expo` + `EXPO_ACCESS_TOKEN` for real push. |
| **Mobile apps (later, EAS)** | The customer/owner/driver Expo apps build via EAS later. Set their `EXPO_PUBLIC_API_BASE_URL=https://api-production-d45a.up.railway.app` and the Stripe **publishable** key. Native apps aren't subject to CORS. |
| **Custom domain (optional)** | `railway domain <yourdomain>` on `api`/`web` + the returned DNS records. The `*.up.railway.app` TLS is sufficient for the pilot. |
| **Hardening (follow‑ups)** | httpOnly‑cookie console token (Inc‑13 follow‑up); a security/pen‑test + load test before go‑live; Postgres SSL if you ever expose the DB beyond the private network. |

---

## 6. Rollback

- **Bad API/web deploy:** `railway deployment list --service <svc> --json` → redeploy the previous good one in the
  Railway dashboard (Deployments → ⋯ → *Redeploy*), or `git revert` the offending commit on `inc14-productionize`
  and `railway up` again. The image is rebuilt from the branch source.
- **Bad migration:** `migrate deploy` only **applies** forward migrations (never destructive auto‑resets). To roll a
  schema change back, ship a new *down* migration — do **not** `migrate reset` (it drops data). The Postgres **volume**
  persists across redeploys, so app rollbacks never lose data.
- **Secret rotation:** `railway variable set <NAME> --stdin --service api` then redeploy. Rotating `JWT_*` invalidates
  live sessions (expected).
- **Full teardown:** `railway down` (latest deploy) or delete the project in the dashboard. The volume must be deleted
  explicitly.

---

## 7. Decisions (deliberate, documented — not papered over)

1. **`NODE_ENV=staging` pilot, SMS guard intact.** The Inc‑2 guard hard‑forbids the console SMS transport when
   `NODE_ENV=production`. With no Twilio creds for the pilot, running as `staging` keeps the guard **intact** (true
   production still refuses console SMS) while the documented pilot allowance returns the OTP `devCode` so the owner can
   log in. This is the prompt's "explicit, documented transport allowance" — **not** a silent guard bypass.
2. **No demo seed in prod.** `seed.ts` is demo‑only; the prod path is the minimal idempotent `bootstrap.ts` (org + owner
   + OWNER role) — §3.
3. **Private DB networking** (no public Postgres proxy) — the API reaches Postgres only on `postgres.railway.internal`.
4. **Strong app‑owned secrets** generated (`openssl rand -hex 32`) and set **only as Railway variables** (`--stdin`),
   never committed. `.gitignore` covers every `.env*`; the images carry no secrets (`.dockerignore`).
5. **Money safety:** Stripe **test mode only**; with no key set, `LocalPaymentProvider` runs (no real money path).

## 8. Parked‑item status (after 14b · re‑checked at the 2026‑06‑27 `792f701` refresh)
- **(a) Notification providers** — **OPEN** (sandbox/console; documented above).
- **(c) AWS S3** — **READY** (bucket `bluebee-media-prod` created + the pipeline PROVEN byte‑identical against it,
  `npm run s3-proof` 18/18). Only remaining step: set the 4 Railway vars on `api` (§5 item **c** / §9) — then the
  driver POD photo/signature uploads AND the Inc‑17 catalog photos become real in the pilot. Boot is unaffected until then.
- **(d) Stripe live test‑mode run** — **OPEN** (LocalPaymentProvider; public webhook URL exists + documented).
- **2026‑06‑27 refresh:** live env upgraded **9→13 migrations** to `main` `792f701` — Track‑A recurring/B2B portal,
  Track‑B resident clothing, cost‑centre split‑billing + web UI, the Daylight reskin, and driver POD are now live
  (no new required env; the parked credentialed items above are unchanged).

---

## 9. S3 media go‑live (bucket created + proven — set the 4 vars to activate)

The media pipeline is env‑selectable already (`apps/api/src/media/storage/s3-storage.provider.ts` + `config/media.config.ts`):
**`S3_ENDPOINT` set ⇒ MinIO (path‑style); `S3_ENDPOINT` UNSET ⇒ real AWS S3 (virtual‑hosted).** No code change was needed
to go live — only the bucket + the vars. The bucket **`bluebee-media-prod`** (`ca-central-1`) is created with default
**SSE‑S3/AES256**, **all public access blocked**, and CORS applied. Proven end‑to‑end (generic + POD + catalog byte‑identical,
private‑bucket 403, signed‑GET expiry, cross‑org 404) by `cd apps/api && npm run s3-proof` → **18/18** against the real bucket.

**a) Railway vars to flip prod from MinIO → real S3 (on the `api` service):**
```bash
railway variable set AWS_REGION=ca-central-1                 --service api
railway variable set S3_BUCKET=bluebee-media-prod           --service api
railway variable set AWS_ACCESS_KEY_ID=<key>       --stdin  --service api   # the Blue Bee IAM user's key
railway variable set AWS_SECRET_ACCESS_KEY=<secret> --stdin --service api   # NEVER commit this
# Leave S3_ENDPOINT UNSET (setting it selects MinIO). Leave MEDIA_ENSURE_BUCKET unset/false (bucket is pre‑provisioned).
```
Reads stay private + signed (`MediaSigner` presigned GET, default TTL 300s). Optional per‑object SSE header via `MEDIA_SSE=AES256`
is NOT needed — the bucket's default encryption covers every object.

**b) Bucket CORS (already applied — required for presigned PUT/GET from the browser console + apps):**
```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://*.up.railway.app", "http://localhost:3001", "http://localhost:19006", "http://localhost:8081"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```
Apply/adjust: `aws s3api put-bucket-cors --bucket bluebee-media-prod --cors-configuration file://cors.json`. Tighten
`AllowedOrigins` to the exact web origin (e.g. `https://web-production-ba508.up.railway.app`) when it's stable.

**c) Least‑privilege IAM policy (the `api` runtime user only needs these on this one bucket):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BlueBeeMediaObjectRW",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:HeadObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::bluebee-media-prod/*"
    }
  ]
}
```
(`s3:DeleteObject` is used by the confirm‑time HEAD‑verify to clean up a bad/mismatched upload. `HeadObject` is covered by
`GetObject` but listed for clarity. No `s3:ListBucket` / `s3:CreateBucket` needed at runtime — the bucket is pre‑provisioned;
keep `MEDIA_ENSURE_BUCKET` off in prod.)

**d) Object migration:** none. The pilot's MinIO media is local test‑mode; existing catalog/POD demo objects are re‑created
by re‑running the real seed/flows against S3 (do **not** copy MinIO blobs). New captures go straight to S3 once the vars are set.

**Deferred (recommendations, not built):** CloudFront/CDN in front of S3 (signed S3 GETs suffice for the pilot); image
resizing/thumbnails; S3 lifecycle/expiry, versioning, cross‑region replication.
