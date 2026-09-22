# Local stack brought up; console and all three Expo apps tested on-device

**Date:** 2026-09-22 (overnight session) · **Status:** complete — console + customer/driver/owner all run and were walked
**Context:** the founder asked for the project to run locally and for all screens to be tested and
fixed. This is the record of what runs, what was broken, what was fixed, and what is still open.

---

## 1. How to run it locally (this machine)

```bash
docker compose -f infra/docker-compose.yml \
  -f "<scratchpad>/compose.localports.yml" up -d      # see §1.1 — Postgres on 5433 here
cd apps/api && npx prisma migrate deploy && npm run db:seed
cd apps/api && npm run start:dev                       # API  :3000
cd apps/web  && npm run dev                            # console :3001
```

| Service | Port | Notes |
| --- | --- | --- |
| Postgres (PostGIS 3.4.3 + TimescaleDB 2.26.4) | **5433** | 5432 is taken by a local PostgreSQL 16 Windows service on this box |
| Redis | 6379 | |
| MinIO (S3 API) | 9000 | console on **9101**, because Windows reserves 9001 |
| API | 3000 | `/v1/health` reports db + redis |
| Console | 3001 | |

### 1.1 Machine-specific, deliberately NOT committed
This box runs a `postgresql-x64-16` Windows service that owns 5432 and wins over the container for
localhost connections (Prisma gets `P1000 authentication failed` while `psql` inside the container
works). Rather than stop a service the founder owns, the container publishes on 5433 via a compose
override kept **outside the repo**, and the local `.env` `DATABASE_URL` points at 5433. The
committed `infra/docker-compose.yml` still uses the normal 5432.

### 1.2 Logins
| Surface | Phone | Code |
| --- | --- | --- |
| Operator console | `+14165557777` | `000000` |
| Customer app | `+14165550010` (Demo Rita) | `000000` |
| Driver app | `+14165550101` (Andre Cole) | `000000` |

`000000` is `OTP_DEV_BYPASS_CODE` in the local `.env`. The operator account is created by
`npm run db:operator` in `apps/api` (new; refuses any non-localhost `DATABASE_URL`).
`OTP_RATE_PER_PHONE`/`PER_IP` were raised to 1000 locally — the **rate limit, not the code**, is what
repeatedly locked sign-in out during testing.

---

## 2. Bugs found and fixed

Full detail in `CHANGELOG.md` (2026-09-22). Summary:

### Setup blockers (repo bugs — a clean clone could not run)
1. **`npm run infra:up` was broken.** `docker.io/minio/minio:latest` now returns `pull access
   denied`; repointed at `quay.io/minio/minio:latest`.
2. **CORS undocumented, so the console could not reach its API.** `main.ts` deliberately keeps CORS
   off unless `CORS_ALLOWED_ORIGINS` is set, but that variable is nowhere in `.env.example`. Symptom
   is nasty: `curl` works perfectly, the browser 404s on preflight, and sign-in fails with "Could
   not send a code". Added to `.env.example` with the symptom written beside it.

### Accessibility (shipping WCAG failures, found by computing contrast from the token values)
12 of 38 real colour pairs failed AA. Four were user-facing and are fixed at source:
- Solid `danger` buttons drew white at **3.91:1** — *Delete account*, *Confirm delete*, *Decline
  quote* in all three apps. New `dangerSolid`/`onDanger` + `successSolid`/`onSuccess` token pairs.
- The same defect in `outline`/`ghost` labels.
- `textTertiary` at **2.68:1**, used 56× as text — the whole light ramp shifted one step.
- Dark-mode filled controls: `onAzure` 3.37:1, `onAzureTint` 3.96:1.
- **The guard is a test, not the hexes:** `tokens.test.ts` now computes WCAG contrast from the token
  values and asserts all 48 pairs, with two known anchors so the maths itself is verified.

### Console defects (found by walking all 16 screens against the running stack)
1. **Fabricated photo evidence** — every `Photo` row and the POD signature pointed at
   `https://demo.local/…`, a domain that does not exist, so the order detail rendered broken images
   exactly where the product promises proof. The seed now PUTs real bytes to MinIO and stores a
   `storageKey`. MinIO 7 → 26 objects; 18/18 photos keyed; 0 `demo.local` references.
2. **Dispatch listed drivers by UUID** — root cause was the API (`DriverView` had no name field),
   not the view. Now returns `user.name`; 2 regression tests.
3. **Service zones rendered as a bare "• off"** — the row is 353px and the control group is a
   `shrink-0` 285px, so the name resolved to 0px. Fixed by stacking the row, not by flex tweaks
   (the first attempt at flex sizing changed nothing — measured in the live DOM).
4. **The demo timeline aged out of every default view** — order dates were pinned to June 2026, so
   Analytics' rolling 30 days showed "—" against 21 real orders. The block now shifts so the newest
   order is always ~1 day old.

### Mobile release config
- **driver `production` and owner `preview` + `production` had no `EXPO_PUBLIC_API_BASE_URL`**, so
  those builds fall back to `http://localhost:3000` — on a device, the phone talking to itself. All
  three apps now set it in both profiles.
- `.gitignore` did not ignore generated native projects (`apps/*/android`, `apps/*/ios`). These are
  managed/CNG Expo apps; one local `expo run:android` dropped several hundred untracked files.

---

## 3. Verified state

| Check | Result |
| --- | --- |
| `turbo run typecheck` | 13/13 |
| `@blue-bee/design-tokens` | 56/56 (was 8 — 48 new contrast assertions) |
| `@blue-bee/ui` | 75/75 |
| `@blue-bee/web` | 237/237 (2 new) |
| `@blue-bee/api` unit | 341/341 |
| customer / driver / owner | 229 / 51 / 30 |
| Console screens | 16/16 render against real seeded data |

---

## 4. Android toolchain (set up this session)

Android Studio + SDK 5.5 GB, AVD `bluebee_pixel` (Pixel 6, Android 14 x86_64), `adb reverse
tcp:3000` so the device reaches the host API on `localhost:3000`.

Two traps worth recording:
- The SDK install **cannot** accept licences from piped input; write the hashes to
  `$ANDROID_HOME/licenses/` directly (standard CI approach).
- The **Gradle wrapper's 10s connect timeout** could not fetch its own distribution even though
  curl pulled it at 3.8 MB/s. Pre-seeded `~/.gradle/wrapper/dists/gradle-8.8-all/…` by hand.
- `config.ts` says "on a SIMULATOR localhost reaches the host machine" — true on iOS, **false on the
  Android emulator**, where the host is `10.0.2.2` unless you use `adb reverse`.

---

## 5. Still open

- **Google Maps Android API key is missing from all three `app.json`.** This was not cosmetic: a
  missing key made `MapView` throw and take the whole screen down (the driver's route screen — the
  app's core — was unusable). Each app now detects the absent key and renders a placeholder instead,
  so the surrounding screens work; but the maps themselves — customer "track my truck", driver route,
  owner fleet — stay untested until a key is added. Needs the founder's Google Cloud account.
- Operational analytics (on-time pickup/delivery, route adherence, dwell) still read `n=0`: the
  demo-timeline shift was scoped to orders, not routes/stops. Extending it is straightforward.
- Pre-existing token bypasses not touched: hard-coded `#0B5FFF` / `#8A99AE` in `FleetMap`,
  `ZoneEditorMap` and the select chevron in `apps/web/components/ui.tsx`.
- Nothing is committed. All work is in the working tree.

---

## 6. App test results — all three apps built and run on an emulator

AVD `bluebee_pixel` (Pixel 6, Android 14 x86_64). Each app built locally with `expo run:android` /
`gradlew assembleDebug`, installed, and driven against the local API over `adb reverse`.

**Ports the device needs tunnelled** — 3000 (API), 8081/8082/8083 (Metro, one per app, they cannot
share) and **9000 (MinIO)**. 9000 is easy to miss: without it every order photo renders blank,
because the API mints signed media URLs against `S3_ENDPOINT=http://localhost:9000` and on a device
`localhost` is the device.

### Customer app — signed in as Demo Rita, walked onboarding → login → home → pricing → order detail → settings → services
Working: 4-slide onboarding (copy is honest, no invented claims), phone OTP with dev code, home with
live orders, pricing from the real catalogue, order detail with a genuine progress spine
(placed → picked up → out for delivery → delivered), honest "Weighing pending — you estimated ~40 kg",
quote with approve/decline, **intake photos now load from MinIO** (the seed fix verified end-to-end
on device), settings placeholders that say "We're building this" when tapped.

Fixed: logo white-box, quick-action truncation, pricing tiles breaking words, the CTA colour
collision. See CHANGELOG 02:50.

### Driver app — signed in as Andre Cole (active shift, 3-stop route)
Working: the location-sharing banner ("Sharing your location with dispatch & the customer · shift
active" — PRD §12.2), shift card with vehicle, route with 1/3 done and per-stop status
(Completed / En route + ETA / Pending), stop detail with arrive / mark-failed / skip / weigh /
message. Background-location permission correctly routes to Android Settings (Android 11+ rule).

Fixed: **the route screen crashed outright** without a Maps key — see CHANGELOG 02:50 item 1.
Fixed: raw enums ("IN_PROGRESS", "DELIVERY") now humanised.

### Owner app — signed in as the local operator
Working: Today dashboard (2 orders today, 21 in flight, 10 completed, On-time honestly "—", collected
and GMV in CAD), Live fleet listing 3 vehicles with honest "snapshot" badges and fix ages, Approvals
badge (2), Exceptions. Fleet map shows the placeholder rather than crashing.

### Open observations (not fixed — need your input or more digging)
1. **Trust-strip claims in the customer app** (`DashboardScreen.tsx:386-389`): "Free Pickup — On all
   orders", "Quality Clean — **Always guaranteed**", "On-time Delivery", "Secure & Safe". These are
   unconditional commercial claims with nothing behind them; the console even measures on-time
   delivery as a KPI that currently reads n=0. CLAUDE.md's honesty firewall bans fabricated
   "certifications, or claims", not only numbers. I did not rewrite marketing copy or delete it —
   what you actually offer is your call.
2. **Driver stop window vs ETA disagree**: stop 2 shows Window 12:42 AM – 1:12 AM but ETA 6:36 AM,
   i.e. an ETA five hours after the window closes. The demo-timeline shift was scoped to orders, so
   route/stop times still come from their own base. Worth reconciling.
3. **First sign-in showed "No shift assigned yet"** for a driver who had an ACTIVE shift; pull to
   refresh fixed it. Likely a fetch that runs before the session settles, or no refetch on resume.
   Needs a focused repro.
4. **Settings rows promise before they disclose**: eight of ten rows are placeholders, but the row
   subtitles ("Manage cards and payment options") read as working features until tapped. A "Soon"
   marker on the row would resolve it — a product decision, not a defect.
5. Operational analytics still read n=0 (see §5).
