# Inc-33 — Customer nav shell (Service · Orders · Profile) + editable Profile

**Date:** 2026-07-11 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Apps:** `apps/customer` (+ `apps/api`, `packages/shared`; `apps/web` verified, unchanged)
**Arc:** Customer App v1 IA (Inc-32 → Inc-35) — see `handoffs/2026-07-10-customer-app-ia-arc.md`.
**Status:** BUILT + verified. **NOT deployed** (the Inc-28→35 arc batch-deploys after Inc-35 is audited). **STOP for audit before Inc-34.**

---

## What shipped (real, no stubs)

### 1. Nav shell — 3 tabs, Book FAB absorbed (`apps/customer/App.tsx`)
- `MainTabs` bottom bar is now **Service · Orders · Profile** (the Refer tab lands in Inc-34 — deliberately **no** empty 4th tab).
- **Service** tab = the catalogue landing (`HomeScreen`, unchanged catalog client). The old center **Book FAB is gone**; Book is now the Service tab's **primary action** — a "Book a pickup" button in `HomeScreen`'s shared header, reachable in **every** state (loading / error / empty / grid), opening the general Book composer. Tapping a specific card still pre-selects that service (unchanged).
- **Orders** tab = existing `OrdersScreen` flow incl. the Inc-32 rate CTA — **zero** changes to that screen.
- **Profile** tab = the reworked `SettingsScreen`.
- **Frozen-contract safety (key decision):** the tab route **names are unchanged** (`Home` · `Orders` · `Settings`) — only the bar's labels/icons changed (Service / Orders / Profile). Keeping `'Settings'` as the Profile tab's route name means `OrdersScreen`'s frozen `navigation.navigate('Settings')` (the header gear) still resolves, and `RootStackParamList` param shapes in `src/navigation.ts` are **untouched**. `src/navigation.ts` needed no change for Inc-33.

### 2. `PATCH /v1/account/profile` — the one new backend piece
- **Shared** (`packages/shared/src/account-profile.ts`, new; exported from `index.ts`): `AccountProfileView` (`{ id, name, email|null, phone|null }`), `UpdateProfileInput` (`{ name?, email?|null, userId? }`), `ACCOUNT_ERRORS`. Cross-surface TYPES only — the request **Zod validator lives with the endpoint** per the arc brief.
- **DTO** (`account.dto.ts`): `updateProfileSchema` — `name` trimmed 1–120; `email` trimmed + **lower-cased**, `''`/`null` ⇒ clear, otherwise validated; optional `userId` self-assertion.
- **Service** (`account.service.ts`, `updateProfile`): same self-only + org-scope discipline as `deleteAccount` — acts on `principal.userId` within `principal.orgId`, **never** a client-supplied id. Order of checks: self-assertion mismatch → **403** `forbidden_self_only`; own row not in caller's org → **404** `account_not_found`; email already held by another user in the org → **409** `email_taken` (friendly pre-check **and** a P2002 catch, so a race can't slip a dup through). Only genuinely-changed fields are written; an unchanged patch is an idempotent no-op returning the current profile. Every real change writes one immutable **`PROFILE_UPDATED`** `AuditLog` (actor = self, before/after name+email). **Phone is never touched** (login identity → Inc-35).
- **Controller** (`account.controller.ts`): `@Patch('profile')`, self-only (no `@Roles`, exactly like delete), `ZodBody(updateProfileSchema)`.
- **Client** (`customer-client.ts`): `updateProfile(input): Promise<AccountProfileView>`.

### 3. Profile screen (`SettingsScreen.tsx` reworked — same file, still route `'Settings'`)
- Views + **edits** `name` and `email`; on save calls `updateProfile`, reflects the **server-normalized** values (email lower-cased), then `reloadMe()` so the whole app sees the change. `email_taken` → inline field error; other failures → a form error; success → "Profile updated."
- **Phone** shown **read-only** with "This is your login."
- Kept intact: **Addresses** (Inc-26), **Corporate** pricing section (Inc-16), **Sign out**, two-step **Delete account** (all original testIDs preserved). **No** placeholder login-methods section (that's Inc-35).

### 4. Cross-surface connection (Inc-27 customer-360)
- No web change needed: `admin-customers.service.ts:173–177` reads `user.name` / `user.email` **live** from the same `User` row this endpoint writes, so `CustomerDetail.tsx` reflects an edit immediately. **Proven at runtime** by an e2e that PATCHes then reads `GET /v1/admin/customers/:id` as OWNER and sees the new name/email.

---

## Frozen-contract note (one deliberate, additive touch to flag)
- `src/session/SessionProvider.tsx` — added a `reloadMe` **passthrough** to `SessionValue` (the session core `useAuthSession` already exposes `reloadMe`, built "for after a profile/role change"). This is **additive**: the frozen `{ status, me, client, requestOtp, login, logout }` shape is unchanged, every existing consumer keeps compiling. Rationale: after a real profile edit the app's `me` (greeting, avatar) should refresh, not go stale until relaunch — this is what makes the slice a genuine vertical, not just a screen-local round-trip. No existing param shape or `src/api/*` signature changed; `src/navigation.ts` untouched.

## Honesty firewall
- No fabricated data/copy. Email uniqueness is real (`@@unique([orgId, email])`), enforced server-side (409). `org_id` on every query; self-only + org-scope server-side; TS strict throughout.

---

## Proof
- `packages/shared` rebuilt (dist emits `account-profile`).
- `tsc --noEmit` clean: **api ✓ · web ✓ · customer ✓** (incl. new test files).
- **customer jest: 22 suites / 186 tests green** (was 180 — +1 HomeScreen "Book primary action reachable in every state + opens Book", +5 SettingsScreen profile-edit: identity render, save-gating, name/email round-trip, 409 inline error, non-conflict error).
- **api e2e: `account.e2e` 12/12** (existing 4 delete + new 8 profile: auth·self-only-403·cross-org-404·bad-email-400·collision-409·update-normalized+audited·console-360-reflects·email-clear). **Full suite: 440/440 passed, 35/35 suites** (baseline 432 + 8 new profile tests; zero regressions).

## Files touched
- `packages/shared/src/account-profile.ts` (new), `packages/shared/src/index.ts`
- `apps/api/src/account/{account.dto.ts, account.service.ts, account.controller.ts}`
- `apps/api/test/account.e2e-spec.ts` (appended a profile-edit describe)
- `apps/customer/App.tsx`, `apps/customer/src/screens/HomeScreen.tsx`, `apps/customer/src/screens/SettingsScreen.tsx`
- `apps/customer/src/api/customer-client.ts`, `apps/customer/src/session/SessionProvider.tsx` (additive `reloadMe`)
- `apps/customer/src/screens/HomeScreen.test.tsx`, `apps/customer/src/screens/SettingsScreen.test.tsx`

## Do NOT deploy
No `railway up`, no EAS. The whole Inc-28→35 set batch-deploys (api + web migrations at boot + one customer EAS rebuild) after Inc-35 is audited. **Report proof, STOP, this chat audits, then Inc-34 (Refer).**
