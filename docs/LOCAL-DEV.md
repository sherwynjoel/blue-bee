# Local development

Everything Blue Bee needs runs on your machine: the API, the web console + business portal, and the
customer, driver and owner apps on an Android emulator. Two commands: `npm run setup` once, then
`npm run dev:all` every day. Both live in `scripts/dev.mjs` (Node built-ins only; Windows, macOS, Linux).

| What | Where | Login (code `000000`) |
| --- | --- | --- |
| Operator console | http://localhost:3001 | `+14165557777` (owner) — or `+14165550002` dispatcher, `03` CSR, `04` plant, `05` finance |
| Business invoice portal | http://localhost:3001 (business accounts land on `/portal`) | `+14165550020` (admin) · `+14165550021` (staff) |
| Customer app | Android emulator | `+14165550010` (Rita, household customer) |
| Driver app | Android emulator | `+14165550101` (Andre Cole — has an active shift and route) |
| Owner app | Android emulator | `+14165550001` |
| API | http://localhost:3000/v1 · docs at `/v1/docs` | — |

Every seeded phone accepts `000000` locally; the apps also fill in the real code for you. No SMS is sent.

---

## 1. Prerequisites

- **Node 20** (`nvm use` reads `.nvmrc`) and **Git**.
- **Docker Desktop**, started and showing "running".
- **For the mobile apps: Android Studio.** In *Device Manager* create an emulator with a **regular
  system image**, e.g. *Pixel 6 · API 34 · Google APIs*. **Not** a "16 KB page size" image: this React
  Native version (0.74) can't install on those (`INSTALL_FAILED_INVALID_APK`). The script picks a
  suitable emulator by itself; set `BLUEBEE_AVD=<name>` to choose one.
- **RAM:** everything at once (Docker + emulator + three app bundlers + web) needs roughly 6–8 GB free.
  On a smaller machine, start only the app you're working on.

## 2. First time

```bash
npm install
npm run setup
```

`setup` is safe to re-run. It:
1. Creates `apps/api/.env` from `.env.example` if you don't have one — random secrets, the `000000`
   dev sign-in code, relaxed sign-in rate limits, and **a free Postgres port** (5432, or the next free
   one if a local Postgres install already owns it).
2. Starts Postgres (PostGIS + TimescaleDB), Redis and MinIO in Docker (`infra/docker-compose.yml`).
   The first run builds the Postgres image (a few minutes).
3. Applies the database migrations, loads the demo data, and creates the console operator login.

## 3. Every day

```bash
npm run dev:all                    # API + web + customer, driver and owner apps
npm run dev:all -- customer        # API + web + just the customer app
npm run dev:all -- driver owner    # any combination
npm run dev:all -- --web-only      # API + web only (console and portal)
```

- The first time an app runs on an emulator it's built and installed (5–15 minutes, once). After that
  it opens in seconds.
- Each app opens once its JavaScript bundle is ready (`[customer] building its JavaScript bundle…`,
  then `opened on the emulator`). On its very first launch the dev build shows Expo's developer menu
  — close it; Android may also ask for notification/location permissions.
- All logs share one terminal, prefixed `[api]`, `[web]`, `[customer]`…
- Type **`rs` + Enter** to restart the API after editing `apps/api`. **Ctrl+C** stops everything.
  The Docker containers and the emulator keep running (fast next start); `npm run infra:down` stops
  the containers.

## 4. Where to edit

| You're changing | Folder | After saving |
| --- | --- | --- |
| Console pages | `apps/web/app/(console)`, `apps/web/components` | browser updates itself |
| Business portal | `apps/web/app/(portal)` | browser updates itself |
| Customer / driver / owner app | `apps/<app>/src` | app reloads in ~1 s (Fast Refresh) |
| Shared mobile UI | `packages/ui` | apps reload |
| API | `apps/api/src` | type `rs` + Enter in the runner |
| Shared types / enums / validators | `packages/shared` | `npm run build --workspace @blue-bee/shared`, then `rs` |
| Database schema | `apps/api/prisma/schema.prisma` | `cd apps/api && npx prisma migrate dev --name <change>` |

## 5. Ports

| Port | Service |
| --- | --- |
| 3000 | API |
| 3001 | Web console + business portal |
| 8081 / 8082 / 8083 | Metro bundler for customer / driver / owner (one each; they can't share) |
| 5432 (or the port in `apps/api/.env`) | Postgres |
| 6379 | Redis |
| 9000 | MinIO (S3 API) · console on 9101 (`minioadmin` / `minioadmin`) |

The emulator reaches your machine through `adb reverse` on 3000 (API) and 9000 (photos); the runner
sets that up. Expo forwards its own Metro port.

## 6. iOS (Mac only, manual)

The runner drives Android only. On a Mac with Xcode:

```bash
npm run dev:all -- --web-only                          # API + web in one terminal
cd apps/customer && npx expo run:ios --port 8081       # another terminal; driver 8082, owner 8083
```

The iOS simulator reaches `localhost` directly, so no port forwarding is needed.

## 7. Troubleshooting

| Symptom | Cause → fix |
| --- | --- |
| `Docker is not running` | Start Docker Desktop and wait until it says "running". |
| `Port 3000 (or 3001) is used by another program` | Another project's dev server is on that port. Stop it; the message shows how to find it. |
| Prisma `P1000 authentication failed` | A local Postgres install answers on the port in `DATABASE_URL`. Delete `apps/api/.env` and re-run `npm run setup` (it picks a free port). |
| Emulator shows "Allow USB debugging?" / runner says the emulator is asking for permission | Tick *Always allow from this computer* → Allow, then re-run. |
| `INSTALL_FAILED_INVALID_APK … Failed to extract native libraries` | The emulator uses a 16 KB page-size image. Create one with a regular image (see Prerequisites). |
| Console sign-in fails with "Could not send a code" | `CORS_ALLOWED_ORIGINS` is missing from `apps/api/.env` — it must include `http://localhost:3001` (it's in `.env.example`). |
| Order photos are blank on the emulator | Port 9000 isn't forwarded: run `adb reverse tcp:9000 tcp:9000` (the runner does this). |
| "Map unavailable" in the apps | Expected: no Google Maps key is configured for local builds. |
| First app build fails at `expo prebuild` with `npm view … exited with non-zero code` | Your npm registry config (e.g. an expired private registry login in `~/.npmrc`) blocks it. Re-run with `npm_config_registry=https://registry.npmjs.org/` set. |
| Emulator closes by itself during a build | Out of memory. Close browsers/other apps and build one app at a time. |
| App shows "There was a problem loading the project: timeout" | It was opened before its bundle finished (e.g. from the home screen). Tap **Reload**, or re-run `npm run dev:all -- <app>`. |
| `adb` commands hang / the runner stalls at the emulator step | Stuck adb server: `adb kill-server` (or end every `adb.exe`), then re-run. |
| `expo start` changed `tsconfig.json` or deleted a file | Shouldn't happen any more (the apps now match what Expo writes). If it does, discard the change and report it. |

## 8. Resetting

- Re-load the demo data (idempotent): `cd apps/api && npm run db:seed`.
- Start from an empty database: `npm run infra:down`, `docker volume rm infra_bluebee_pg`, then `npm run setup`.
