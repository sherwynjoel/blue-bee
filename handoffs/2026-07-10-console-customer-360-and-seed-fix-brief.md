# Brief — Console customer-360 view (+ fold in the seed UUID fix)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Apps:** `apps/api` + `apps/web`
**From:** planning/QC chat · **For:** Claude Code. Founder decisions (2026-07-10): build the console customer-360 **before** Step 2 (scheduling); **fix** the seed UUID collision; **batch** the Step 1 (saved-addresses) deploy rather than shipping it alone.
**Rules:** no stubs · `org_id` on every row + server-side row-scoping · OWNER/CSR-gated (staff view PII) · TS strict · reuse existing services, don't duplicate · log `CHANGELOG.md` + a dated handoff.

---

## Why this exists (verified gap)
The console has **no consolidated residential-customer view**. Staff can see a customer only *through* an order or the OWNER-gated `/admin/users` role list; there is no `/customers` page showing one consumer's profile, saved addresses, and order history in one place. B2B accounts have `AccountDetail` (a real 360); residential/consumer customers (the published-price wash pivot) have nothing equivalent — and that matters now that Step 1 gave consumers saved addresses. (Note: the driver↔customer **chat is deliberately staff-invisible** — a deferred moderation surface — so this view does NOT surface chat. Keep that boundary; call it out in the UI as "not shown here" if anything, and treat console chat moderation as a separate future decision.)

## Part A — Console customer-360 (read-only v1)

**Backend (`apps/api`):** OWNER/CSR-gated, org-scoped, reuse existing services.
- `GET /v1/admin/customers` — paginated list of **residential customers** (users holding `RESIDENTIAL_CUSTOMER` in the org), searchable by name / phone / email. (`/admin/users` already lists org users with role grants — reuse/extend rather than duplicate; this is the customer-filtered, searchable view.)
- `GET /v1/admin/customers/:id` — the 360 aggregate: identity + contact (name, phone, email, status, joined), **saved addresses** (their `Site`s incl. geo + serviceability from Step 1), **order history** (reuse the orders read, filtered to their account/orders), **payments/invoices** (reuse the invoices/payments read), devices/notification status (masked tokens, as `/admin/devices` already does). No chat.
- Row-scope + audit: org-scoped; consider writing an `AuditLog` entry on 360 access (staff viewing PII) — the audit surface already exists.

**Frontend (`apps/web`):**
- New console route **`/customers`** (list: search + rows showing name/phone/last order/status) → **`/customers/[id]`** (the 360: contact card, Addresses section, Order history reusing the existing order-row component + link to `/orders/[id]`, Payments/Invoices, memberships/corporate). Reuse `AccountDetail`'s layout patterns.
- Add **"Customers"** to the `AppShell` sidebar (Commercial section, near Accounts).
- Tests: web component tests (list renders, search, detail sections, empty states); api unit + e2e (list/search, 360 aggregate, role-gate 403 for non-staff, org-scope, PII-access audited).

**Scope guard:** read-only v1. Staff *editing* a customer (change contact, add an address on their behalf) is a deliberate follow-up, not this increment — flag it, don't build it. Show only real data; no placeholders.

## Part B — Seed UUID collision fix (fold in)
`apps/api/prisma/seed.ts:467` and `:776` assign the **same UUID** to two different users; "Demo Test Owner (simple login)" seeds first, so the care-home admin's `upsert` matches on `id` and inherits an **org-wide OWNER grant** — a real tenancy hole, and the cause of the 4 `care-home-linen.e2e-spec.ts` failures (403→201, 404→200). 
- Reassign the duplicate so the care-home admin gets its **own** id and stays an account-scoped role; keep `+14165550030` as its intended scoped login (founder confirmed it's fine to reassign). 
- Grep for any other reference to the reassigned UUID before changing it (no silent breakage). 
- Verify: `care-home-linen.e2e` 4 red → green; **full e2e 340/340**; the tenancy assertions (a care-home admin is NOT an org owner) hold.

## Deploy
Batch the deploy: ship **Step 1 (saved addresses) + this customer-360 + the seed fix** together in one `railway up` (api + web) — they touch the same customer/address data, so the 360 surfaces Step 1's addresses live. (This supersedes "batch Step 1 with Step 2" — customer-360 landed in between and is the natural deploy companion.) CC runs `railway up`; the working tree is committed in sync now, so no stash/pop. **Then** Step 2 (pickup scheduling) resumes the customer-app Tier-2 order.

**Boundary:** the planning chat does not run `railway up` or touch DB credentials — CC executes and shows the verification.
