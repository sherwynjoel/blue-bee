# Blue Bee — Railway deploy runbook (Increment 14b)

**Working folder:** `/Volumes/Gowtham/Blue Bee` · **Branch:** `inc14-productionize` · **Stack target:** PRD §10.2 infra.

This is the **operational runbook** for the live Phase‑1 (specialty) pilot environment on Railway. It describes
every service, every environment variable (names only — **values live only on Railway, never in git**), the
migration + real‑org bootstrap plan, the founder's manual steps, and rollback.

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
warm‑up) before booting. The **9 migrations** are applied to the Railway Postgres (verified:
`SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL` → **9**; `postgis 3.4.3`, `timescaledb 2.26.4`).
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

### Live smoke test (proven)
```bash
API=https://api-production-d45a.up.railway.app
curl -s $API/v1/health            # → 200 {database up postgis+timescaledb, redis PONG}
# OTP login (devCode returned because NODE_ENV=staging):
curl -s -X POST $API/v1/auth/otp    -H 'content-type: application/json' -d '{"phone":"+14165550100"}'
curl -s -X POST $API/v1/auth/verify -H 'content-type: application/json' -d '{"phone":"+14165550100","code":"<devCode>"}'
curl -s $API/v1/me -H "authorization: Bearer <accessToken>"   # → the owner + OWNER role
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

---

## 5. Founder manual steps (close the parked integrations / harden)

| Item | What to do |
|---|---|
| **SMS / true production (a)** | For real OTP SMS, set `SMS_TRANSPORT=twilio` + `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`, then flip `NODE_ENV=production`. **Until then the pilot runs `NODE_ENV=staging` with console OTP** (the Inc‑2 guard forbids console SMS only under `production`). |
| **AWS S3 (c)** | Create the `ca-central-1` bucket `bluebee-media` with **default SSE** encryption; set `AWS_REGION=ca-central-1`, `S3_BUCKET=bluebee-media`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` on `api`. **Do NOT set `S3_ENDPOINT`** (that selects MinIO). Until set, `/v1/media/presign` errors (boot is unaffected). |
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

## 8. Parked‑item status after 14b
- **(a) Notification providers** — **OPEN** (sandbox/console; documented above).
- **(c) AWS S3** — **OPEN** (real‑S3‑no‑creds; documented above).
- **(d) Stripe live test‑mode run** — **OPEN** (LocalPaymentProvider; public webhook URL now exists + documented).
- New: the live API + console URLs above; the deployed Stripe webhook URL is now public for the founder to register.
