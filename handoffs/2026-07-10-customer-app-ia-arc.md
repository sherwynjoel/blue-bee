# Customer App v1 — Information Architecture arc (Inc-32 → Inc-35)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **App:** `apps/customer` (+ `apps/api`, `apps/web`)
**From:** planning/QC chat · **For:** Claude Code — **build one increment, report proof, this chat audits, then the next.** Do NOT run the whole arc in one pass.
**Founder decisions (2026-07-10):** Refer = invite + codes + attribution + console visibility **now**, reward mechanism **deferred** (so NO reward is promised in-app yet). Ratings CTA folds into the Orders tab. Profile keeps phone-OTP **and** adds email+password **and** Apple/Google login, plus editable name/email.

## The target (customer bottom nav = 4 tabs)
**Service** (catalogue) · **Orders** (history + live tracking + in-order chat + rate) · **Profile** (name/email/addresses/login/account) · **Refer** (invite + code + who-joined).

## Non-negotiables (every increment)
- **No stubs.** Real DB + migration + endpoint + screen + tests, proven to run. A capability is built-and-working this increment or it's not in it. `org_id` on every row; server-side row-scope; TS strict; lifecycle/enums per PRD.
- **Honour the frozen contract** (`apps/customer/UX-REDESIGN-BRIEF.md` §1): don't break existing `src/api/*` call signatures, `session`, or existing `navigation` param **shapes**. Adding tabs/screens/params is fine; changing an existing param shape is not — if you think you must, STOP and flag.
- **Honesty firewall:** the Refer tab must NOT promise a reward (none is wired yet). No fabricated credits, offers, or "earn $X" copy. Industry framing only where relevant.
- **Everything connects across surfaces** (the point of this arc): each customer feature below has a real API path and, where it makes sense, shows up in the web console (owner) and/or driver app. No feature is customer-only if the data is shared.
- Log each increment to `CHANGELOG.md` + a dated `handoffs/` file. **Do NOT `railway up`** — batch-deploy the whole set (with the already-built Inc-28/29/30/31) at the end + one customer EAS rebuild.

## What already exists (do NOT rebuild — verified in code)
- **Service/catalogue:** `catalog.service.ts` + client `getServices/getServiceMenu/getDrycleanCatalog`; `HomeScreen`, `BookScreen`, `DrycleanPicker`. Owner sets rates in `/catalog` (web). → Service tab is a **reshuffle**, not new backend.
- **Orders:** `OrdersScreen` → `OrderDetailScreen` → `TrackScreen` (live truck) → `ChatScreen` (per-order, two-party, live during the active delivery window — `chat.service.ts` + realtime gateway). Payments (`PayScreen`). → Orders tab is **existing**, plus the new rate CTA.
- **Profile:** `SettingsScreen` = identity (name/phone **read-only**), Addresses (Inc-26), Corporate join-code, Sign out, two-step Delete (`account.service.ts` — delete only). `User.email` exists (`schema.prisma:421`, `@@unique([orgId, email])`) but is **not editable** and there is **no profile-update endpoint**.
- **Console customer view:** Inc-27 customer-360 (`/customers`, `/admin/customers`, `AccountDetail.tsx`). New customer-facing data should surface here.
- **No referral anything** — confirmed (all "refer" hits are false positives). Refer is net-new.

---

## INC-32 — Ratings / CSAT + rate-request push (folds CTA into Orders)
Build per the detailed spec in `handoffs/2026-07-10-step3-ratings-csat-brief.md` §Inc-32 (unchanged). Summary:
- **Schema:** `Rating` (`id, orgId, orderId, score Int 1–5, comment String?, submittedByUserId`, house cols; `@@unique([orgId, orderId])`). Migration, no backfill.
- **Shared:** `packages/shared/src/ratings.ts` (Zod `createRatingSchema`/`patchRatingSchema`, `RatingView`, `RATING_ERRORS`); `export *`.
- **API:** `POST/PATCH/GET /v1/orders/:id/rating` — roles `RESIDENTIAL_CUSTOMER, ACCOUNT_ADMIN`, idempotency-keyed; eligibility = order reached `DELIVERED` (delivered-or-later); ownership via the `resolveOrderRecipients` join; one rating/order (409 on dup); PATCH by original submitter ≤30 days.
- **Push:** new `RATE_REQUEST` event + template; **enqueue from the `DELIVERED` transition** in `deliveryCompleteLeg` (Inc-31 left this slot clean) → the order's customer recipients, honoring existing `NotificationPreference`.
- **Console/analytics:** flip `analytics.service.ts:427` `csat: deferred(...)` → real `this.metric<number>(...)` (avg score); add an avg-rating tile to `accountScorecard()` → `AccountDetail.tsx` scorecard.
- **App:** `customer-client` `submitRating/updateRating/getRating`; add `rating` to `FULL_INCLUDE` so `getOrder` returns it; `RateScreen` (1–5 + optional comment); **"Rate this order" CTA on `OrderDetailScreen` after the timeline** and on the delivered `OrderCard` — this is the CTA that lands in the Orders tab.
- **Connections:** customer Orders ↔ api ↔ console analytics + scorecard; push ↔ driver-completed delivery.
- **Verify:** `ratings.e2e-spec.ts` (mirror `pod.e2e`): eligibility 4xx before DELIVERED, dup→409, PATCH scope 403, cross-account 403/404, staff create 403, idempotent replay, analytics avg. Customer screen test (CTA shows only when delivered-and-unrated; submit posts). tsc green all three; shared rebuilt.

## INC-33 — Nav shell (Service · Orders · Profile) + editable Profile
Introduce the 4-tab structure with the three real tabs; the Refer tab lands in Inc-34.
- **App nav (`apps/customer/App.tsx` `MainTabs` + `src/navigation.ts`):** replace `Home/Orders/Settings` + Book FAB with tabs **Service · Orders · Profile** (Refer added Inc-34). Keep all existing stack screens (`Book/OrderDetail/Track/Chat/Pay/Addresses/AddressForm/Rate`). Existing nav param shapes unchanged (frozen-contract safe).
  - **Service tab** = the catalogue landing: the services grid (reuse `HomeScreen`/catalog client) with "Book" as the primary action (absorb the Book FAB into this tab). No new backend.
  - **Orders tab** = existing `OrdersScreen` flow, now including the Inc-32 rate CTA.
  - **Profile tab** = reworked `SettingsScreen` content (see below).
- **Profile edit (the one new backend piece here):** `PATCH /v1/account/profile` in the `account` module — updates `User.name` and `User.email` for the authenticated principal only (self-only, like delete). Email: validate + enforce `@@unique([orgId, email])` (409 `email_taken` on collision); trim/lowercase. Zod schema in `account.dto.ts`; audited via `AuditService`. Client method `updateProfile`. Phone stays read-only here (it's the login identity; changing it is an auth concern, not profile).
  - **Profile screen** shows + edits **name**, **email**; shows **phone** (read-only, "your login"); keeps **Addresses**, **Corporate**, **Sign out**, **Delete**. Login/methods section is a placeholder-free "Phone (primary)" until Inc-35 adds the others.
- **Connections:** name/email edits ↔ api ↔ console customer-360 (Inc-27) reflects the updated name/email.
- **Verify:** `account.e2e` extended — update name/email succeeds, email-collision→409, self-only (can't patch another user)→403, cross-org→404. Customer screen tests for Service tab (catalogue renders + Book navigates) and Profile (edit name/email round-trips, all states). tsc green.

## INC-34 — Refer (invite + code + attribution + console), reward deferred
Net-new, real, but **no reward wired** — the app invites and tracks; it does not promise or grant anything.
- **Schema:** add `User.referralCode String? @unique` (generated once per customer, short, unambiguous) and `User.referredByUserId String?` (nullable self-relation, set once, immutable). Optional `Referral` row for a clean console list (`id, orgId, referrerUserId, referredUserId, createdAt`) — or derive from `referredByUserId`; pick one and keep it real. Migration + backfill `referralCode` for existing customers.
- **Attribution (capture point):** at **account creation** (the OTP registration path that mints a new customer), accept an optional `referralCode`; if valid + the new user has none set, record `referredByUserId` (+ `Referral` row). Self-referral and unknown codes are rejected silently (no attribution), never error the signup. One-time, immutable.
- **API (customer):** `GET /v1/account/referral` → `{ code, shareUrl }` (real code; `shareUrl` a deep link if configured, else the code only — no fake domain); `GET /v1/account/referrals` → who joined via my code (name-minimal, count). Row-scoped to self.
- **API (console/owner):** surface referrals in customer-360 (`AccountDetail`) — "referred by X" / "referrals made: N". Read-only.
- **App:** **Refer tab** + `ReferScreen` — shows my code, a native Share action (share sheet), and my joined-referrals list/count. **Copy invites friends to Blue Bee; it does NOT state or imply a reward** (none exists yet). Add the 4th tab to `MainTabs`.
- **Honesty:** no "earn/get $X", no credit balance, no unbacked promise. When the reward ledger is built later, the copy + grant become real together.
- **Connections:** customer Refer ↔ api ↔ console customer-360 attribution.
- **Verify:** `referral.e2e` — code is stable + unique; a new signup with a valid code records `referredByUserId` once; self-code + unknown-code → no attribution, signup still succeeds; second attribution attempt is a no-op; `GET referral`/`referrals` row-scoped (another user can't read mine). Console shows attribution. Screen test: code + share + list render; **assert no reward/credit copy**. tsc green.

## INC-35 — Login expansion: email+password + Apple + Google (own increment — heaviest, security-sensitive)
Phone-OTP stays the primary/existing path; **add** the others alongside. Build + audit this alone before it ships.
- **Store rules to respect:** if the app offers third-party sign-in (Google), **Apple requires Sign in with Apple** be offered too (App Store guideline) — building both together is correct. Email+password needs secure hashing (argon2/bcrypt), email verification, and rate-limited attempts.
- **Backend:** extend auth to support (a) email+password credential (hash at rest, verify, `POST /v1/auth/register` + `/login` + email-verify + password-reset), and (b) OAuth (Apple, Google) — verify provider token server-side, link/create the `User` (there is already an `authProviders` field on `User` — use it), dedupe by verified email so the three methods resolve to one account. All org-scoped, RBAC unchanged (a customer is still a `RESIDENTIAL_CUSTOMER`). Reuse the existing `TokenService`/refresh flow to mint the same session.
- **App:** `LoginScreen` gains "Continue with Apple", "Continue with Google", and email+password (+ "forgot password"). Profile → Login/security section shows linked methods + link/unlink.
- **Honesty/security:** real provider verification (no trusting client claims); never store plaintext; the `000000` OTP dev bypass is a separate known pre-launch blocker — do not extend a bypass to the new methods.
- **Connections:** all methods ↔ api auth ↔ same session; linked-methods visible in Profile (and optionally console customer-360).
- **Verify:** auth e2e for each method (register/login/verify/reset for email; provider-token verify + account-link/dedupe for Apple + Google; wrong-password lockout; cross-method same-account resolution). tsc green. **Flag for the audit chat:** provider keys/secrets (Apple, Google) are founder-supplied config — never committed; the build uses sandbox/test credentials.

---

## Deploy (after all four are built + audited)
One batched `railway up` (api + web) covering **Inc-28, 29, 30, 31, 32, 33, 34, 35** (migrations run at boot via `prisma migrate deploy`) + **one customer EAS rebuild** (all the new screens reach phones at once). Roll the "delivery live + customer app v1" milestone up to `Projects/CHANGELOG.md` `[BLUE BEE]`.

## Build order & audit gates
Inc-32 → Inc-33 → Inc-34 → Inc-35. Each: build → report proof (status/paths/assertions) → this chat audits the shipped code → next. Nothing deploys until the batch at the end.
