# Blue Bee — Mobile app store compliance & data declarations

**Status:** launch-scaffolding (branch `launch-scaffolding`). This document is the single source of
truth for the Apple **App Privacy** and Google Play **Data safety** declarations, the **permission
usage strings**, the iOS **privacy manifests**, the **background-location** justification, and the
**account-deletion** policy across the three Expo apps (customer, owner, driver).

**Honesty firewall.** Everything here is verifiable against the code in this repo. We declare only what
the apps actually do. We claim **no third-party certifications** (no SOC 2 / ISO / HIPAA badge) and use
**no third-party advertising or analytics SDKs**. Card data is handled by **Stripe** (PaymentSheet);
it never touches Blue Bee servers (PCI SAQ-A) and is not declared as collected by our apps. Card-data
declarations for the Stripe SDK are covered by Stripe's own bundled privacy manifest.

---

## 1. Account deletion (App Store 5.1.1(v) / Google Play account-deletion policy)

In-app, every app exposes **Settings → Delete account** (a two-step confirm). It calls the real API
`DELETE /v1/account` (auth required; a user can only delete themselves — a request targeting another
user is refused with **403**). On success the app clears its session tokens and signs out.

**What the server does** (`apps/api/src/account/account.service.ts`, one DB transaction, audited):

| Data | Action |
|---|---|
| `RefreshToken` (all sessions) | **Hard-deleted** — every session is revoked |
| `DeviceToken`, `Device` (push tokens, device records) | **Hard-deleted** |
| `Notification`, `NotificationPreference` | **Hard-deleted** |
| `UserRole` (access grants) | **Hard-deleted** — all access revoked |
| `Driver.license` (driver licence on file) | **Scrubbed to null** (the Driver row is kept because shift/route operational records reference it) |
| `User.name` | Overwritten with `"Deleted user"` |
| `User.email`, `User.phone` | Set to **null** (login by phone/OTP is no longer possible) |
| `User.authProviders` | Cleared (`[]`) — external identities severed |
| `User.status` | Set to `SUSPENDED` |

**Why anonymize-in-place rather than hard-delete the row.** The `AuditLog` table is **append-only**
(a database trigger blocks `UPDATE`/`DELETE`) and its `actor_id` foreign key is `ON DELETE SET NULL`.
A hard delete of a user who has ever acted (including the deletion event itself) would fire a SET-NULL
*update* against the immutable audit log and abort. Anonymizing the user row in place removes all
personal data while keeping the tamper-evident audit trail intact — which is itself a privacy/security
control. This requires **no schema change**.

**What is intentionally retained** (and is no longer personally identifying once the steps above run):
the anonymized `User` row; operational/business records (orders, invoices, payments, claims, message
bodies) that reference an account/site or the now-anonymous user. These are kept for legal/tax
retention (see §4). The deletion writes one immutable `ACCOUNT_DELETED` audit entry containing **only a
non-PII summary** (counts + booleans) — never the scrubbed values.

Evidence: API e2e `apps/api/test/account.e2e-spec.ts`; per-app component tests
`apps/*/src/screens/SettingsScreen.test.tsx`; per-app client tests assert `DELETE /v1/account`.

---

## 2. Data collected, by app (Apple App Privacy / Play Data safety)

None of the data below is used for **tracking** (cross-app/cross-site for ads). All of it is **linked**
to the user's account and used for **App Functionality** only.

### Customer app (`com.bluebee.customer`)
| Data type | Why | Where in code |
|---|---|---|
| Name | Account identity (shown on orders) | auth `/me`, profile |
| Phone number | Phone-OTP sign-in | `requestOtp`/`verifyOtp` |
| Photos | Optional before/after photos attached to an order | `expo-image-picker`, `/media/presign` |
| Purchase history | Orders/jobs booked and their status | `/orders` |
| Device ID (push token) | Push notifications for order updates | `expo-notifications`, `/device-tokens` |

The customer app shows the **driver's** truck position during delivery; it does **not** collect the
customer's own location.

### Owner app (`com.bluebee.owner`)
| Data type | Why | Where in code |
|---|---|---|
| Name | Operator account identity | auth `/me` |
| Phone number | Phone-OTP sign-in | `requestOtp`/`verifyOtp` |
| Device ID (push token) | Operational push alerts | `expo-notifications`, `/device-tokens` |

The owner app requests **no** camera/location/contacts permissions.

### Driver app (`com.bluebee.driver`)
| Data type | Why | Where in code |
|---|---|---|
| Name | Driver account identity | auth `/me` |
| Phone number | Phone-OTP sign-in | `requestOtp`/`verifyOtp` |
| **Precise location (background)** | Live truck position for dispatch + customer ETA, **while on an active shift only** | `src/location/tracker.ts`, `/locations:batch` |
| Device ID (push token) | Operational push alerts | `expo-notifications`, `/device-tokens` |

---

## 3. Background location (driver app) — justification

Apple/Google require a clear justification for background location. Blue Bee's is:

- **Purpose:** show dispatch and the customer the truck's real-time position and ETA during pickup and
  delivery.
- **Strictly shift-gated:** location is collected **only while a shift is `ACTIVE`**. The gate is
  enforced in app code — `ingestFixes()` drops every fix when no shift is active, and
  `startTracking()`/`stopTracking()` bracket collection to shift start/end (and to sign-out, via the
  session `onSignOut` hook). Proven by `apps/driver/src/location/tracker.test.ts` ("does NOT emit
  before a shift is active").
- **Consent-gated:** foreground then background permission are requested explicitly; if denied,
  tracking does not start.
- **Visible while on:** iOS shows the background-location indicator; Android runs a foreground service
  with a persistent "shift active — sharing your location" notification.
- **Stops immediately** on shift end or sign-out.
- **Data minimization:** invalid sensor values are dropped before transmission (`toPing()`); only
  lat/lng (+ optional speed/heading) and a timestamp are sent.

Android permissions (`apps/driver/app.json`): `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
`ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`.
iOS usage strings: `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`
(both state the shift-only scope).

---

## 4. Data retention

Per PRD §12.4 (Canada / PIPEDA-aligned):

- **Live location pings:** full resolution **7 days** → downsampled breadcrumbs **90 days** → purge/aggregate.
- **Proof-of-delivery photos/signatures:** per contract & legal default **24 months**.
- **Audit & financial records:** per Canadian tax/retention law **7 years** (immutable audit log).
- **Account deletion:** PII is removed/anonymized immediately on request (§1); retained records are
  anonymized business/financial records only.

---

## 5. Permission usage strings (present + honest)

| App | iOS (`infoPlist`) | Android (`permissions`) |
|---|---|---|
| customer | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` | `CAMERA`, `READ_MEDIA_IMAGES` |
| owner | (none beyond `remote-notification` background mode) | (none) |
| driver | `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription` | location + foreground-service set (see §3) |

Push notifications use the `expo-notifications` permission prompt (no Info.plist usage string is
required for remote notifications; Android 13+ `POST_NOTIFICATIONS` is added by the plugin).

## 6. iOS privacy manifests

Each app declares an iOS privacy manifest via `expo.ios.privacyManifests` in `app.json` (Expo SDK 51
writes the build's `PrivacyInfo.xcprivacy` from this). A literal `apps/<app>/PrivacyInfo.xcprivacy`
mirror is also committed as the reviewable artifact (kept in sync with `app.json`). Each declares
`NSPrivacyTracking = false`, the §2 collected-data types, and the required-reason API
`NSPrivacyAccessedAPICategoryUserDefaults` (reason `CA92.1` — React Native reads `NSUserDefaults`).
First-party Expo modules ship their own manifests (in `node_modules`) for the APIs they use.

## 7. EAS build configuration

Each app has an `apps/<app>/eas.json` with `development` / `preview` / `production` profiles
(`development` is a simulator/dev-client internal build; `preview` and `production` are internal/store
distributions on EAS Update channels). **No cloud builds are run here** — `preview`/`production` builds,
TestFlight, and Play submission require the paid Apple/Google accounts and an `eas init` project id,
which are out of scope for this branch (founder's task). The configs are JSON- and structure-valid
(verified locally).
