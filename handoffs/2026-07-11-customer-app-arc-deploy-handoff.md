# BLUE BEE — context handoff (2026-07-11) · Customer App v1 arc built + audited, staging deploy in flight

## What this chat is / role boundary
This chat **plans, briefs, decides, and QCs**. **Claude Code (CC)** in VS Code writes, commits, and deploys. This sandbox cannot reach Railway, git, EAS, or the external drive via bash — use Read/Grep/Glob on host paths (`/Volumes/Gowtham/Blue Bee`). The working loop that's held all session: CC builds an increment → reports proof → **this chat independently audits by reading the actual shipped code** → decisions made here → CC executes. Every increment logs `CHANGELOG.md` + a dated `handoffs/` file. Honesty firewall throughout (no fabricated data, prices, capacity, offers, or claims).

## Live infra
- API `https://api-production-d45a.up.railway.app` · Console `https://web-production-ba508.up.railway.app`
- One org: `11111111-1111-4111-8111-111111111111`. Railway project **Blue Bee**, env "production" but **`NODE_ENV=staging`** (so the `000000` OTP bypass is active — this is effectively staging, not real-customer prod).
- App logins (OTP `000000`): owner `+14165550001` · customer `+14165550111` (Grace) · driver `+14165550006`.
- E2e seed phones: owner …0001 · dispatcher …0002 · csr …0003 · plant/PLANT_OP …0004 · finance …0005 · rita/RESIDENTIAL_CUSTOMER …0010.
- `railway` CLI authed (onskim2@gmail.com); `eas` authed (founder Expo account).

## The arc: Customer App v1 IA (Inc-30 → Inc-35) — ALL BUILT + AUDITED CLEAN
Master brief: `handoffs/2026-07-10-customer-app-ia-arc.md`. Target customer bottom nav = 4 tabs: **Service · Orders · Profile · Refer**.

- **Inc-30 — Production advance** (`QUOTE_APPROVED→IN_CLEANING→QC→READY` + REWASH branch). `ProductionService` (mirrors IntakeService), 4 `@Roles(OWNER,CSR,PLANT_OP)` endpoints (`start-cleaning`/`send-to-qc`/`qc`/`rewash`), console `ProductionActions`. Closed a dead-enum gap: nothing moved orders past QUOTE_APPROVED before. **Audited clean.**
- **Inc-31 — Delivery legs** (`READY→SCHEDULED_DELIVERY→DELIVERY_EN_ROUTE→DELIVERED`). Mirrors pickup legs; **POD gate moved into shared `run()`** so DELIVERED is unreachable without a `ProofOfDelivery` from BOTH the driver and ops/dispatch paths; `DELIVERY_KINDS` promoted to `stop-kinds.ts`; per-item DELIVERED custody in `ITEM_ORDER_BY`; made the dead `DELIVERED→INVOICED` payment path live. **Audited clean.**
- **Inc-32 — Ratings/CSAT + push.** `Rating` model (`@@unique([orgId,orderId])`), `POST/PATCH/GET /v1/orders/:id/rating` (customer-side roles, eligibility=delivered-or-later, one-per-order 409, PATCH own ≤30d). `RATE_REQUEST` push fired **post-commit** from `run()` gated on the order actually reaching DELIVERED (leg returns the id). `analytics.service.ts:427` csat flipped deferred→real avg; account scorecard `avgRatingScore`. RateScreen + CTA. **Audited clean.**
- **Inc-33 — Nav shell (3 real tabs Service/Orders/Profile) + editable Profile.** `PATCH /v1/account/profile` (name/email, self-only, email unique-per-org 409, audited). Tab route names kept `Home/Orders/Settings` (relabelled only) so frozen `navigate('Settings')` still resolves. `SessionProvider` additive `reloadMe` (approved — shape unchanged). **Audited clean.**
- **Inc-34 — Refer** (invite + code + attribution + console), **reward DEFERRED**. `User.referralCode @unique` + `referredByUserId`. `ReferralService.ensureCode` (concurrency-safe mint) + `attributeReferral` (set-once, silent no-op on bad/self/unknown, tx-aware). `GET /v1/account/referral` + `/referrals`. Console customer-360 referral card. ReferScreen = 4th tab, **no reward copy** (honesty). NOTE: live attribution has no call site until Inc-35 registration — `attributeReferral` is proven by e2e, wired live in Inc-35. **Audited clean.**
- **Inc-35 — Login expansion** (email+password + Apple + Google, alongside phone-OTP). `JwksOAuthVerifier` (RS256 pinned/alg-confusion guard, JWKS-verified, iss/aud/exp, claims only from verified payload, fail-closed). `PasswordService` (bcryptjs cost 12). `CredentialAuthService`: register (referral capture **inside signup tx**), login (Redis rate-limit + lockout, no 000000), email verify + password reset (single-use SHA-256-hashed tokens, reset revokes sessions), OAuth dedupe by verified email + **pre-hijack clear** of an unverified password, account-security link/unlink (refuses last method). App: LoginScreen + Profile Login&security. On-device OAuth throws `OAuthUnavailableError` with an honest "not set up in this build" message until Expo modules + client IDs are wired (NOT a deceptive stub — backend is real + e2e-tested). **Audited clean.**

**Inc-35 minor hardening nits (non-blocking, on record):** register/oauth-create don't catch P2002 → a concurrent-dup race yields 500 not 409 (DB still prevents dup); register reveals email existence (enumeration — accepted); email-keyed lockout enables account-lockout DoS + no per-IP limit (accepted, configurable); verifier doesn't reject missing-`exp` (unreachable for provider-signed tokens). Fold in whenever a polish pass happens.

(Inc-28 pickup scheduling + Inc-29 item-ordering predate this chat's audits; reported built + verified.)

## Deploy — IN FLIGHT (staging, no real customers). Decisions locked:
CC ran pre-flight gates:
- **Gate 1 ✅** `prisma migrate status` clean, 27 migrations ordered, nothing pending.
- **Gate 2 ✅** Full api e2e on a **fresh seeded DB** = **456/456 (37 suites)**; customer 199/199; web 214/214. (The earlier 455/456 red was shared-DB pollution on Account B, not a defect.)
- **Gate 3 — DECIDED: deploy to staging WITHOUT secrets.** SendGrid/OAuth/`REFERRAL_SHARE_BASE_URL` are missing on Railway (founder-supplied, not in this chat). Leave `EMAIL_TRANSPORT` as console (verify/reset tokens log, don't send — fine on staging); OAuth stays fail-closed/honest; shareUrl null. Do NOT set `EMAIL_TRANSPORT=sendgrid` without the key (boot crash). `DEFAULT_SIGNUP_ORG_ID` default resolves to the seeded org.
- **Gate 4 — DECIDED: commit the arc first.** 174 uncommitted files in a shared dir with concurrent agents → CC reviews `git status`, excludes any non-arc/side-work (STOP + flag if a file can't be attributed), commits Inc-28→35 as a certified artifact + rollback point, then deploys.

**CC has been given the deploy command** (commit → `railway up` api+web → post-deploy smoke [`/api/health`, a rating read, `/v1/account/referral`, `/v1/auth/methods`] → customer EAS production build → roll the milestone to `Projects/CHANGELOG.md` `[BLUE BEE]`).

### ▶ IMMEDIATE NEXT ACTION (for the new chat)
**Await CC's deploy report and audit it:** the commit hash(es) + any files CC paused on as unattributable, the `railway up` logs, the smoke results, and the EAS build link. Confirm the Inc-32/34/35 migrations landed on staging.

## Parked — the real go-live blockers (after staging validates)
- **`000000` OTP bypass still active** — hard blocker before real customers. Recommended next brief.
- **Secrets:** `SENDGRID_API_KEY`/`EMAIL_TRANSPORT=sendgrid`/`EMAIL_FROM`; `OAUTH_GOOGLE_CLIENT_IDS`/`OAUTH_APPLE_CLIENT_IDS`; `REFERRAL_SHARE_BASE_URL`; Tier-1 Maps Android key + Stripe `pk_test`.
- **On-device Expo OAuth** modules (`expo-apple-authentication` / `expo-auth-session`) + client IDs to activate the social buttons.
- Seed drift on prod; the leaking accounts-portal e2e spec's teardown (test hygiene — Account B order accumulation).

## Key files
- Master arc brief: `handoffs/2026-07-10-customer-app-ia-arc.md`
- Step-3 detail brief (Inc-30/31 wiring + Inc-32 ratings): `handoffs/2026-07-10-step3-ratings-csat-brief.md`
- Inc-31 kickoff: `handoffs/2026-07-10-inc31-delivery-legs-kickoff.md`
- CC per-increment handoffs: `handoffs/2026-07-11-inc32-ratings-csat.md`, `-inc33-nav-shell-profile.md`, `-inc34-refer.md`, `-inc35-login-expansion.md`
- PRD `docs/laundry-platform-PRD.md` · `CHANGELOG.md` · `BUILD-PLAN.md` · customer frozen-contract `apps/customer/UX-REDESIGN-BRIEF.md`
