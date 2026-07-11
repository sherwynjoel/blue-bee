# Handoff — Blue Bee: test logins, Vercel, dev-client loop, customer-app UX redesign (2026-07-09)

Paste this into a new chat to continue. Working repo: **`/Volumes/Gowtham/Blue Bee`** (the canonical checkout — has Stripe/invoice code the `bluebee-integration` copy lacks). Currently on branch **`feature/s3-media-golive`** with several unrelated uncommitted changes piled on it (git hygiene debt — see Open Items).

## Live infra (Railway)
- **API:** https://api-production-d45a.up.railway.app (`/v1/health`, `/v1/docs`) — `NODE_ENV=staging`, `SMS_TRANSPORT=console`. Private Postgres (`postgres.railway.internal`, no public proxy) — DB only reachable via `railway ssh --service api`. Deploy via `railway up --service api --ci` from the repo (NOT git-push; push ≠ deploy).
- **Web console (dashboard):** https://web-production-ba508.up.railway.app (Next.js, live on Railway).
- Note: this Cowork sandbox can't reach the Railway domain or the private DB — all API/DB/git/eas commands are run by the founder on his Mac.

## Auth / test logins (WORKING)
- Phone-OTP. Because staging+console SMS, the code is returned as `devCode` in `/v1/auth/otp` AND logged; not texted.
- **Fixed-OTP dev bypass shipped + live:** `OTP_DEV_BYPASS_CODE=000000,0000` is set on Railway; the new API code is deployed (SUCCESS deploy ~03:32 IST). So any seeded phone logs in with **OTP `000000`**. (Gated off when `NODE_ENV=production`; founder OK with it on for the pilot.)
- Anchor owner `+14165550100` (bootstrap) works. **Demo seed status: only partially confirmed** — the rich demo org (`seed.ts`) may not have fully run in the container (earlier `+14165550101` returned invalid; the seed attempt ran on the Mac by mistake once, and a later `railway ssh` reseed was blocked by the auto-mode safety classifier). If demo logins fail, re-run the seed IN the container: `railway ssh --service api` → wait for `root@…:/app/apps/api#` → `npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' prisma/seed.ts` (do NOT use `npm run db:seed`; explicit compiler-options needed — tsconfig isn't in the image). Do NOT re-run the full demo seed against prod per the runbook — but this is a pilot org, founder's call.
- **Login map (demo org, all OTP `000000`):** dashboard `1234567890` (or `4165550001`); driver app `4165550101` (Andre — Route 1 IN_PROGRESS); customer app `4165550111` (Grace — order out for delivery, live tracking). Corporate is not a separate login — it's an `Account.corporate=true` with join code `MAPLELOFT` (Maple District Towers), managed in the console under Commercial → Corporate.

## Vercel (frontend hosting — config staged, not deployed yet)
- Decision: web console (dashboard) → Vercel; Railway stays the API backend.
- Added `apps/web/vercel.json` (mirrors the proven web Dockerfile monorepo install/build). Not yet deployed. Steps when ready: `vercel link` from repo root → Project Settings Root Directory=`apps/web`, Node 20.x, env `NEXT_PUBLIC_API_BASE_URL=https://api-production-d45a.up.railway.app` → `vercel --prod` → then add the Vercel origin to the API's `CORS_ALLOWED_ORIGINS` (`railway variable set … --service api`).

## Dev-client loop (WORKING — this is how UI is previewed with NO 1–2 hr rebuilds)
- Customer app has a **dev-client build** installed on the phone (built via `eas build --profile development --platform android`). UI changes hot-reload in ~1s; only build a `preview`/`production` APK at the very end.
- **Connectivity gotcha (solved):** the home router isolates devices (LAN failed even with firewall off + correct IP), and the `--tunnel` DNS wouldn't resolve on the phone. **Working setup = phone hotspot:** turn on phone Personal Hotspot → connect Mac to it → `ipconfig getifaddr en0` for the new IP → `EXPO_PUBLIC_API_BASE_URL=https://api-production-d45a.up.railway.app npx expo start --dev-client` (no tunnel) → in the dev client, connect to `http://<that-ip>:8081`.
- **Always** prefix Metro with `EXPO_PUBLIC_API_BASE_URL=…railway…` (else the app hits `localhost` and shows no data). Or put it in `apps/customer/.env`.
- Confirm you're in the **dev-client** app, not the old preview app (both installed, identical icon): shake → Expo dev menu = dev client. Push-token warning on boot is harmless.

## Customer-app UX redesign (IN PROGRESS)
- Goal: restyle to the founder's reference (clean light look, 2-up service grid, icon circle → title → description → feature tags → "from $" footer, bottom tab bar). Method + guardrails in **`apps/customer/UX-REDESIGN-BRIEF.md`**.
- Architecture: app already has a token layer (`theme/`, `useTheme()`) + primitives (`components/ui`: Text/Button/Card/StatusPill/EmptyState/SkeletonCard). Screens: Login/Orders/Book/OrderDetail/Track/Chat/Pay/Settings. **FROZEN (never touch during restyle):** `src/api/*`, `src/session/*`, `src/navigation.ts` param shapes, `src/push/*`, `src/config.ts`, `@blue-bee/*`, and each screen's `client.*` calls/hooks.
- **Done by Claude Code:**
  - Light theme pinned (`theme/ThemeProvider.tsx` → `lightTheme`) + `app.json` `userInterfaceStyle: "light"`. Commit `b281fde`.
  - `DrycleanPicker` → 2-up photo/price card grid (data-driven from `getDrycleanCatalog()`). Commit `795966d`.
  - New `HomeScreen.tsx` = service grid driven by `getDrycleanCatalog()` (icon → title → description → feature tags → "from $" footer; loading/empty/error). Root nav → **bottom tab bar** (Home · Orders · center Book FAB · More; no invented "Prepaid"). Commit `6cc666f`. `tsc` ✓, 98/98 tests ✓.
- Founder decision: home cards should be **real/connected**, using the services we have, with card content (description/features/icon) made real in the **backend** — NOT hard-coded. **Backend wiring deferred** ("wire the backend later"). So today the grid renders with real `priceFrom` but empty description/features/icon.

## Open items / next steps
1. **Preview on device:** reload the dev client to view the new light Home grid + tab bar. (Was the last step — confirm 2-col alignment, Book FAB, spacing feel right.)
2. **Next restyle pilots:** Orders screen, then Book screen, to match the Home look.
3. **Backend catalog wiring (deferred):** additive fields `description` / `features[]` / `icon` on the catalog (ServiceCategory/Service) + expose in the catalog API + console Catalog admin to edit + seed sample copy for existing services (CAD, real prices, no invented data). Requires `railway up` + reseed for the app to see it.
4. **LOCKFILE LANDMINE (do before next EAS build):** `@react-navigation/bottom-tabs` is in `package.json` but the root `package-lock.json` isn't committed in sync (tangled with uncommitted EAS-build deps: expo-dev-client/expo-splash-screen/expo-updates). Hot-reload works now (JS-only dep), but EAS `npm ci` will FAIL until an in-sync `package.json` + `package-lock.json` is committed. Fix: at repo root, `npm install` to regenerate a coherent lock, then commit the package.json(s) + `package-lock.json` together — before kicking off any preview/production build.
5. **Git hygiene (soon):** `feature/s3-media-golive` is carrying unrelated uncommitted work (S3 + OTP bypass + vercel + UX + EAS). Plan a cleanup: land these into `main` deliberately.

## Standing rules (Blue Bee)
Phase-1 only; no stubs/no fabricated data (honesty firewall); lifecycle enums match the PRD; log every build in `CHANGELOG.md` (newest on top, IST) + material milestones roll up to `Projects/CHANGELOG.md` under `[BLUE BEE]`; save handoffs in `handoffs/`. Claude Code (VS Code) does the coding; this chat plans/briefs/decides.
