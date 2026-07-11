# Handoff — EAS Android build enablement for the Driver + Customer apps (2026-07-09)

**Goal of this session:** get the **Driver** and **Customer** Expo apps (SDK 51 / RN 0.74.5) building via **EAS** and running on a physical **Android** phone against the **live Railway API**. (Owner app exists but was not touched this session.)

This session was **build/config enablement + fixes only** — no product feature code changed. All fixes are on disk but **NOT yet git-committed** (see "Commit these" below).

---

## Environment (the machine)

- **MacBook Air, Apple Silicon (arm64), 8 GB RAM.** Homebrew present.
- System Node was **v24** (too new — SDK 51 / RN 0.74 break on it). Installed **nvm + Node 20.20.2** (repo requires `>=20 <21`). **Every new terminal defaults back to Node 24 → always run `nvm use 20` first in this repo.**
- Installed: **watchman**, **eas-cli 20.5.1**.
- Expo account: **gautam1337** (personal). `gautam1337s-team` also exists — we used the personal one.

## Strategy decisions

- **EAS cloud builds**, free tier (~1 hr queue at peak). Chosen over local Android Studio because **8 GB RAM** can't comfortably run an emulator + a native build. No Android Studio, no Xcode, **no Docker**.
- **Backend stays on Railway** (already deployed + healthy) — no local infra.
- **Build type = `preview` profile = standalone APK** (install-and-go, JS baked in, no Metro tether). This is what the user wants: download APK → install on Android → open → it talks straight to Railway. (The `development`/dev-client profile tethers to Metro on the Mac — not what we want.)
- $19/mo EAS Starter (priority queue) was offered as the better fit for 8 GB hardware; user chose free tier for now.

## Live backend

- **API:** `https://api-production-d45a.up.railway.app` — verified `/v1/health` OK (Postgres + PostGIS 3.4.3 + TimescaleDB 2.26.4 + Redis all up).
- Apps default to `http://localhost:3000`; the `preview` profile **bakes the Railway URL** via `eas.json` env so the standalone APK reaches it.

## EAS project IDs

- Driver: `32b3f490-99a7-4faf-87d9-d6ecb24f9d28`
- Customer: `862c2326-8f90-45b6-a49b-e5f12b15c540`

---

## Fixes applied this session (the important record)

1. **Added dev/update tooling to both apps.** `npx expo install expo-dev-client expo-updates` → `eas init` (created the projects above, wrote `extra.eas.projectId` into each `app.json`) → `eas update:configure` (set `updates.url` + `runtimeVersion {policy: appVersion}`).

2. **Removed invalid `newArchEnabled` from both `app.json`.** SDK 51's config schema rejects the top-level `"newArchEnabled": false` → made `expo doctor` fail. Removed from `apps/driver/app.json` and `apps/customer/app.json`.

3. **Pinned `expo-font` to `12.0.10`** in the **root `package.json` `overrides`**. Root cause of the first hard Gradle failure: `@expo/vector-icons@14.1.0` declares a loose peer `expo-font@"*"`, so npm hoisted **`expo-font@56.0.7`** (an **SDK 56** package) into this SDK 51 project. That produced the Gradle errors: `Plugin [id: 'expo-module-gradle-plugin'] was not found` (in `expo-font/android/build.gradle`) and `Could not get unknown property 'release'` (in `ExpoModulesCorePlugin.gradle`). **npm ignored the override on a normal install ("up to date")** — had to `rm -f package-lock.json && npm install` to force it. Verified: `node -p "require('./node_modules/expo-font/package.json').version"` → `12.0.10`.

4. **Added a root `postinstall`** to `package.json`: `npm run build --workspace @blue-bee/shared && npm run build --workspace @blue-bee/api-client`. Reason: both apps import `@blue-bee/shared` and `@blue-bee/api-client`, which compile via `tsc` to a **gitignored `dist/`**. A standalone (`preview`) build bundles JS in the cloud and needs those `dist/` folders to resolve, so we rebuild them on every install (local + EAS cloud). Verified the hook runs (built both packages during `expo install`).

5. **Baked the Railway API URL into the `preview` profile** of both `eas.json` files: `env.EXPO_PUBLIC_API_BASE_URL = https://api-production-d45a.up.railway.app`.

6. **Fixed the splash-screen resource-linking failure.** After fix #3 the build ran **386/386 Gradle tasks** and failed only at `:app:processDebugResources` with `resource color/splashscreen_background not found` — the prebuild writes `drawable/splashscreen.xml` referencing `@color/splashscreen_background` but never writes the color into `values/colors.xml`. Fix: `npx expo install expo-splash-screen` (0.27.7, correct SDK 51) **plus** a deterministic local config plugin **`plugins/withSplashscreenBackgroundColor.js`** in each app (uses `withAndroidColors` to write `splashscreen_background = #ffffff`), wired into each `app.json` `plugins`. (Note: the stock `expo-splash-screen` plugin's `backgroundColor` prop did **not** write the color; the custom plugin does.) Verified via prebuild → `colors.xml` now contains `splashscreen_background`.

## Local verification (done — no cloud needed)

- `npx expo prebuild -p android --no-install` (driver) → generated `colors.xml` contains `splashscreen_background` ✅
- `npx expo export -p android` — **both apps bundle clean**: driver **1058 modules**, customer **1104 modules**, zero errors ✅ (this is the exact JS-bundle step the cloud preview build runs).

## Build progression (evidence the fixes worked)

- Early builds: failed at Gradle with the `expo-modules-core` / `expo-font` plugin errors → fixed by #3.
- Post-#3 build: ran **386/386 tasks**, failed only on the splash color → led to #6.
- Post-#6: both apps `expo export` clean → **two `preview` builds fired and are queued on EAS** (this is where the session ended; user will paste the build results into the new chat).

---

## Current state at handoff

**Two `preview` (standalone APK) builds queued on EAS free tier** — driver + customer. Awaiting results.

## Gotchas / standing notes

- **Always `nvm use 20`** in this repo before any `expo`/`eas`/`npm` command (new shells default to Node 24).
- **Always verify locally before a cloud build:** `npx expo prebuild -p android --no-install` (config/resources) + `npx expo export -p android` (JS bundle). ~2 min vs a ~1 hr cloud queue.
- Free-tier queue ~1 hr at peak; after upload you can Ctrl+C (build continues server-side). `eas build:list` to check.
- **Do NOT run `npm audit fix --force`** — it bumps packages off SDK 51 and reintroduces exactly the version drift we fought. The audit warnings are dev-tooling noise.
- **A leftover local `android/` folder makes EAS detect a BARE workflow** → `runtimeVersion {policy: appVersion}` is unsupported → the build errors at upload with `You're currently using the bare workflow...`. **Run `rm -rf android ios` before every EAS build** so it stays a managed (CNG) project and regenerates natively in the cloud. (This bit the first driver `preview` build; fix = remove `android/`, rebuild.)

## Commit these (not yet in git)

`package.json` (root: `overrides.expo-font` + `postinstall`), `package-lock.json`, `apps/driver/app.json`, `apps/customer/app.json`, `apps/driver/eas.json`, `apps/customer/eas.json`, `apps/driver/plugins/withSplashscreenBackgroundColor.js`, `apps/customer/plugins/withSplashscreenBackgroundColor.js`, and the added deps (`expo-dev-client`, `expo-updates`, `expo-splash-screen`) in both app `package.json`.

## Known gaps in the first APKs (expected, non-blocking)

- **Maps blank** until a Google Maps Android API key is added (`app.json` → `android.config.googleMaps.apiKey`). Affects customer "track my truck" + driver route map.
- **Stripe checkout** won't process until a `pk_test_` publishable key is provided (app boots fine without; server may return one via create-intent).

## Next steps

1. When the preview builds finish → download the APK per app on the Android phone → install (allow "unknown sources") → open.
2. Verify against Railway: login (phone OTP), customer book / orders / track list, driver route / stop / POD, in-app chat.
3. Add Google Maps API key; add Stripe `pk_test` key; rebuild.
4. Later: iOS build (needs Apple Developer account or a Mac + Xcode), owner app, then commit all fixes to git.
