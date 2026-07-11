# Handoff — Test logins for the 3 apps + Vercel hosting for the web console (2026-07-09)

Both `preview` (standalone APK) EAS builds finished and are installed on the Android phone (driver + customer). This session solved the two blockers after that: **(1) there were no users to log in as**, and **(2) hosting the company dashboard on Vercel** while Railway stays the backend. No product code changed. One config file added: `apps/web/vercel.json`.

## The auth reality (from `docs/DEPLOY-RAILWAY.md` + the code)
- Login is **phone-OTP**. `POST /v1/auth/otp {phone}` → `POST /v1/auth/verify {phone, code}`.
- The pilot runs `NODE_ENV=staging` + `SMS_TRANSPORT=console`, so the OTP is **NOT texted** — it is returned as **`devCode`** in the `/v1/auth/otp` JSON response AND logged by the API (`SMS → +1416…: Your Blue Bee verification code is XXXXXX`).
- `verify` requires a **User row with that exact phone + status ACTIVE**. Before this session only the pilot **owner `+14165550100`** existed (via `prisma/bootstrap.ts`), in an **empty anchor org** — so the driver/customer apps had nobody to log in as, and the owner dashboard was data-empty.
- The Postgres DB is **private** (`postgres.railway.internal`, no public proxy) — reachable only via `railway ssh --service api`. It cannot be reached from a laptop directly or from any external tool.

## Fix (1): seed the demo tenant → instant logins + real data
Decision (founder, this session): **run the demo seed** (`prisma/seed.ts`). It writes a **separate, clearly-labelled demo org** (`11111111-…`) and never touches the pilot anchor org. It creates every role login + rich connected data (fleet on the move, orders across every lifecycle stage, custody, POD, cost centres).

Run it **inside the API container** (safe against the missing-tsconfig issue by passing explicit compiler options, exactly like `bootstrap.ts`):
```bash
railway ssh --service api
# inside the container:
cd /app/apps/api
npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' prisma/seed.ts
```
Idempotent — a re-run is a no-op on already-seeded blocks. The runtime image ships `prisma/`, keeps `ts-node`/`prisma` in `node_modules`, and has `@blue-bee/shared/dist` + the generated Prisma client, so this runs as-is. The script prints a login-phone summary at the end.

### The logins that matter (all in the demo org, so their data is connected)
| Surface | Log in as | Phone (type this) | OTP | Why this one |
|---|---|---|---|---|
| **Company dashboard** (web console) | Demo Test Owner | **1234567890** (or `4165550001`) | `000000` | Whole demo org: live fleet map (3 vehicles moving), all orders, cost centres, billing. |
| **Driver app** | Andre Cole | **4165550101** | `000000` | Driver on **Route 1 = IN_PROGRESS**: stop 1 DELIVERED (+POD), stop 2 EN_ROUTE (live ETA), stop 3 PENDING — the full route → stop → scan → POD flow. |
| **Customer app** | Grace Okafor | **4165550111** | `000000` | Owns the order that is **out for delivery** (DELIVERY_EN_ROUTE) — her "track my truck" shows Andre's van moving with a live ETA. Also has delivered/paid + overdue history. |

(OTP `000000` only works once `OTP_DEV_BYPASS_CODE` is set — see below. Without it, use the log-fishing fallback.)

Other useful demo logins: Priya Nair `+14165550110` (customer, orders across booked/quoted/in-cleaning/damage-flagged), Rita `+14165550010` (customer, one QUOTED rug), Bianca `+14165550102` (driver, PUBLISHED pickup route). The pilot anchor owner `+14165550100` still works but its org is empty.

### Getting the OTP code — two ways

**Preferred (fixed bypass code, added 2026-07-09 03:11 IST):** a staging-only shortcut lets any seeded phone log in with a fixed code, no log-fishing.
- Enable once on Railway: `railway variable set 'OTP_DEV_BYPASS_CODE=000000,0000' --service api` (redeploys the API).
- Then in any app: enter the phone, type **`000000`** (or `0000`) as the code → in.
- New memorable dashboard login: phone **`1234567890`** (E.164 `+11234567890`, OWNER) + `000000`.
- **Gated:** `loadDevBypassCodes()` returns `[]` when `NODE_ENV=production`, so it's inert in prod even if the var is left set; it's also inert until the var is set. **The bypass resolves by phone against ANY active user — including the real anchor owner `+14165550100`** — so keep `OTP_DEV_BYPASS_CODE` unset (or `NODE_ENV=production`) for any real launch.

**Fallback (no bypass enabled):**
1. In the app, enter the phone → tap "Send code".
2. On the Mac: `railway logs --service api | grep "verification code"` (the line for that phone shows the 6-digit code).
3. Type it into the app.

### Known gaps while testing (pre-existing, non-blocking)
- **Mobile app maps** (customer track-truck, driver route) are blank until a **Google Maps Android API key** is set. The **web dashboard** map uses Leaflet/OpenStreetMap → **works with no key**.
- **Photos** (intake/POD) are demo URLs (`demo.local`) → thumbnails won't render, but the data/flow shows. Real uploads need S3 (parked).
- **Stripe** checkout in the customer app needs a `pk_test_` key.

## Fix (2): host the web console (company dashboard) on Vercel — Railway stays the API
The console (`apps/web`, Next.js 14) is client-rendered and calls the Railway API cross-origin. Added **`apps/web/vercel.json`** that mirrors the proven `apps/web/Dockerfile` install/build for the npm-workspaces monorepo (build `@blue-bee/shared` → `@blue-bee/api-client` → `web`).

### One-time Vercel setup (run from the repo root `/Volumes/Gowtham/Blue Bee`)
```bash
cd "/Volumes/Gowtham/Blue Bee"
nvm use 20
npm i -g vercel        # if not installed
vercel login
vercel link            # create/link a project (e.g. "bluebee-console")
```
Then in the Vercel **Project → Settings**:
- **Root Directory** = `apps/web` (this makes Vercel read `apps/web/vercel.json`; the `cd ../..` in it reaches the monorepo root).
- **Node.js Version** = `20.x` (repo engines: `>=20 <21`).
- **Environment Variable** (Production, and Preview if wanted): `NEXT_PUBLIC_API_BASE_URL = https://api-production-d45a.up.railway.app` — inlined at build time.

Deploy:
```bash
vercel --prod          # from the repo root; note the returned production URL
```

### Whitelist the Vercel origin on the API (CORS — required, else the dashboard's calls are blocked)
The API only allows the origins in `CORS_ALLOWED_ORIGINS` (CSV). Add the Vercel domain (keep the Railway web origin for now):
```bash
railway variable set 'CORS_ALLOWED_ORIGINS=https://web-production-ba508.up.railway.app,https://<your-vercel-domain>' --service api
```
Setting it (no `--skip-deploys`) triggers an API redeploy. Note: only the **production** Vercel domain is whitelisted — per-commit **preview** URLs will be CORS-blocked unless added. Once verified on Vercel, the Railway `web` service can be retired (drop it in the Railway dashboard) since Railway is now backend-only.

## Deploy order (because there's now real API code, not just config)
```bash
# 1. Ship the API code (Railway rebuilds with the new seed + bypass logic)
cd "/Volumes/Gowtham/Blue Bee"
git add apps/api .env.example apps/web/vercel.json
git commit -m "feat(api): staging OTP dev-bypass + memorable test-owner login; chore(web): vercel.json"
git push        # your Railway deploy flow
# 2. Enable the fixed OTP (staging only; redeploys the API)
railway variable set 'OTP_DEV_BYPASS_CODE=000000,0000' --service api
# 3. Seed the demo tenant (now also creates +11234567890)
railway ssh --service api
cd /app/apps/api
npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' prisma/seed.ts
```

## Not yet committed to git
- API dev-bypass change (2026-07-09): `apps/api/src/auth/otp.service.ts`, `apps/api/src/config/auth.config.ts`, `apps/api/prisma/seed.ts`, `apps/api/src/auth/otp.service.spec.ts` (new), `.env.example`. Typecheck clean, unit test 7/7.
- `apps/web/vercel.json` (new).
- Everything from the 2026-07-09 EAS session (still uncommitted — see that handoff's commit list).
