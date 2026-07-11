# Handoff — Inc-27: Console customer-360 (read-only) + the seed UUID fix + the batched deploy

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Branch:** `feature/s3-media-golive`
**Apps:** `apps/api` + `apps/web` · **Status:** ✅ Built, tested, **deployed live** (api + web), verified.
**Batched with:** Inc-26 saved addresses (`handoffs/2026-07-10-inc26-saved-addresses.md`).

> **Read §6 first if you read nothing else.** The deploy shipped the *code* fix for the seed collision.
> **Production's data still carries it.** That needs a decision.

---

## 1. Part B — the seed UUID collision (done first, to get a green baseline)

`apps/api/prisma/seed.ts` assigned the **same uuid** to two different fixtures:

| | id | rid | role |
|---|---|---|---|
| `:467` "Demo Test Owner (simple login)" | `e1000000-…-010` | `e2000000-…-010` | `OWNER` / `ORG` |
| `:776` `B1.adminUid` "Demo Care-Home Admin" | `e1000000-…-010` | `e2000000-…-010` | `ACCOUNT_ADMIN` / `ACCOUNT` |

`seedAuthFixtures()` runs before `seedTrackBDemo()`, so the care-home `upsert` matched the owner **by id**.
The damage was silent, and **worse than the brief described**:

1. The care-home admin was **never created**. There is no `Demo Care-Home Admin` row at all.
2. It inherited the owner's **ORG-wide `OWNER` grant** instead of an account-scoped `ACCOUNT_ADMIN` one — a
   real tenancy hole, and the cause of the 4 red assertions in `care-home-linen.e2e-spec.ts` (404→200, 403→201).
3. The care-home upsert's `update: { phone: '+14165550030' }` **clobbered the test owner's `+11234567890`
   login**, which had quietly stopped existing.

**Fix:** grepped every reference to the duplicate id first (exactly two, both in `seed.ts`), then gave `B1`
its own `…-011` pair, with a comment explaining why so nobody reuses a `…-0NN` across fixture tables.

**Verified after re-seeding:**
```
e1000000-…-010  Demo Test Owner (simple login)  +11234567890   OWNER          ORG
e1000000-…-011  Demo Care-Home Admin            +14165550030   ACCOUNT_ADMIN  ACCOUNT b0000000-…-a0
OWNER grants held by +14165550030: 0
```
`care-home-linen.e2e` **4 red → 12/12 green**. Full api e2e **340/340** *before* Part A began.

---

## 2. Part A — the customer-360

### 2.1 Endpoints
- `GET /v1/admin/customers` — cursor-paginated; searches name / phone / email case-insensitively.
- `GET /v1/admin/customers/:id` — identity + grants, saved addresses (Inc-26 point + coverage), account
  order history, invoices, payments, devices (token masked), corporate memberships, notification config.

**A separate `AdminCustomersController`, not three more methods on `AdminController`.** That class carries a
class-level `@Roles(OWNER)`. `RolesGuard` uses `getAllAndOverride`, so a method-level `@Roles(OWNER, CSR)`
*would* widen it — but leaning on decorator precedence to widen a **PII gate** is exactly what breaks
silently when someone reorders decorators. The new class states the gate once, at the top. Every other
`/v1/admin` route stays OWNER-only.

### 2.2 Reused, not re-implemented
`scopedPrisma` (org boundary) · `ServiceZonesService.isServiceable` (the **same** PostGIS `ST_Covers` gate the
booking path uses — a second coverage implementation is how the console comes to disagree with the truck) ·
`maskPushToken` · `AuditService` · `decimalMoney` + `parseOrderTotals` from `orders/money.ts`.

### 2.3 ⚑ Two real bugs my own tests caught
1. **`Decimal.toString()` drops the trailing zero.** An invoice of `158.20` was crossing the wire as
   `"158.2"` and would have rendered **"$158.2"**. `orders/money.ts` says so in a comment: every
   `Decimal(12,2)` read back must pass through `decimalMoney`. Now it does.
2. **I had hand-rolled an `Order.totals` parser.** `parseOrderTotals` is the single source of truth for "is
   this order billable, and for how much", shared by the batch-invoice engine and the cost-centre split. Two
   parsers is how the console and the invoice engine drift. Deleted mine; delegated.

### 2.4 The honesty firewall, in the contract and on screen
| Data fact | Naive render | What ships |
|---|---|---|
| `Order` has **no `userId`** — orders hang off the ACCOUNT | "Orders: 6" | `accountOrderCount`; header **"Account orders"**; subtitle "Orders on this customer's account" |
| `Order.createdBy` unset | "Booked by: Staff" | `bookedByThisCustomer: null` → **em dash** |
| Org has **zero active zones** ⇒ gate inert | "Outside service area" | `checked: false` → **"Coverage not checked"** |
| Site has no PostGIS point | a coverage guess | `serviceability: null` → **"No map pin"** |
| No `NotificationPreference` row | "SMS: On" | `configured: false` → "…has not changed their settings; they are on the defaults" |
| Unpriced order | `$0.00` | **em dash** |
| Driver↔customer chat | a chat tab | **absent from the aggregate**; the page names the boundary |

### 2.5 Confinement + accountability
- A **staff user's id → 404** (and the response body is asserted not to contain their name). This route reads
  consumer PII; it must never become a staff-PII read. An `ACCOUNT_ADMIN` → 404. Cross-org → 404 both ways.
- Malformed id → 400. `limit=0|999` or a bad cursor → 400. Blank `?search=&cursor=` → 200 (blank is *absent*).
- Opening one 360 writes exactly one immutable `CUSTOMER_360_VIEWED` audit row naming the staff actor.
  **Listing writes none** (a directory read is not a PII drill-down). A **403 or 404 writes none** — nothing
  was read. The console never even calls the endpoint for a principal who may not look.

### 2.6 Web
`/customers` (search + directory) → `/customers/[id]` (the 360; each order links to `/orders/[id]`).
**Customers** added to the Commercial sidebar beside Accounts. `can.customers` mirrors `@Roles(OWNER, CSR)`.
`orderTone` **lifted out of `AccountDetail` into `lib/format.ts`** so the B2B 360 and the consumer 360 tint
the same status identically rather than drifting.

**Scope guard honoured:** read-only v1. Staff *editing* a customer (contact details, or adding an address on
their behalf) is a deliberate follow-up — flagged here, not built.

---

## 3. Tests

| Suite | Before | After |
|---|---|---|
| api unit | 261 | **277** (+16 `admin-customers-policy.spec.ts`) |
| api e2e | 340 (4 red) | **368 / 368**, 31 suites (+28 `admin-customers.e2e-spec.ts`) |
| web | 152 | **178** (+26) |
| customer | 144 | 144 (untouched) |

`tsc` clean across api · web · customer · shared · api-client.
The new e2e uses its own `c7000000-` fixtures, torn down in `beforeAll` **and** `afterAll`, and leaves ORG1
with **zero active service zones** (every other spec depends on that).

---

## 4. Deploy — batched Step 1 + Inc-27 + the seed fix

`railway up --service api`, then `--service web`. Both **SUCCESS**.

**api.** Boot-time `prisma migrate deploy` applied **Inc-26** to production — proven, not assumed: live
`GET /v1/sites` as OWNER now returns `unit` / `buzzer` / `notes` / `isDefault` on all 13 sites. All four new
routes answer **401 (live + auth-gated), not 404** — including the escaped-colon
`POST /v1/sites/<uuid>:deactivate` on real Railway.

**Verified live as the real principals:**
- OWNER `+14165550001` → `GET /v1/admin/customers` → **4 real residential customers** (Grace, Priya, Rita,
  Tom — no test residue).
- Grace's 360 → her real address (geo `-79.54, 43.599`, `serviceability {checked:false}`), 6 account orders
  (`total: null` on the unpriced ones, `257.08` on the priced one — `decimalMoney` working), 2 invoices,
  1 payment, `notifications.configured: false`, **no `chat` key**.
- Residential customer `+14165550010` → **403** on both routes.

**web.** `/customers` went **404 → 200**. One retry was needed: a stale `.watchman-cookie-*` file left by the
jest runs broke Railway's file indexer mid-upload (`watchman watch-del` + `shutdown-server`, then redeploy).
**Verified the shipped bundle**, not just the build — pulled the 14 chunks `/customers` references (637 KB)
and the 13 that `/customers/[id]` references (643 KB) and grepped: `Account orders`, `admin/customers`,
`Search by name, phone or email`, `Coverage not checked`, `In service area`, `Outside service area`,
`No map pin`, `Orders on this customer`, `Booked by`, the chat footnote, and the notifications-default copy.

**Live:** api `https://api-production-d45a.up.railway.app` ·
console `https://web-production-ba508.up.railway.app/customers` (OWNER `+14165550001`, OTP `000000`).

---

## 5. ⚑ §PROD — what this deploy does NOT fix. **Founder's call.**

`railway up` runs `prisma migrate deploy`. **It does not re-seed.** The seed fix is a *code* fix, so
**production's rows still carry the collision.**

Verified through the OWNER-only `GET /v1/admin/users` — *not* a DB shell. (A remote read into the prod
container was correctly refused by the permission layer; the brief authorised `railway up`, not a prod shell,
and I did not work around it.)

```
live row e1000000-…-010 :  name "Demo Test Owner (simple login)"
                           phone +14165550030
                           roles [(OWNER, ORG)]
care-home admin on prod :  none
+11234567890 on prod    :  does not exist
```

**Consequences on the live console:**
- `+14165550030` logs in as a **full ORG-wide OWNER** (with `OTP_DEV_BYPASS_CODE` active). It was meant to be
  an account-scoped care-home admin.
- The memorable `1234567890` login is **dead**.

**This is a data mutation, not a deploy — so I did not touch it.** Remediation is one small reviewable script:

1. `UPDATE "User" SET phone = '+11234567890' WHERE id = 'e1000000-0000-4000-8000-000000000010';`
   → restores the simple login and stops `+14165550030` being an owner.
2. Create the care-home admin under `e1000000-…-011` **only if prod actually has the Maple Grove account**
   (`b0000000-…-a0`) — today it does **not**, so step 2 is probably a no-op on prod.

Note the ordering constraint: `User` has `@@unique([orgId, email])`, not on `phone`, so step 1 is safe.

**Say the word and I'll write it, dry-run it, and show the before/after.**

---

## 6. ⚑ Also flagged, not fixed — dev-DB residue

`corporate-pricing.e2e-spec.ts` creates stable `ce000000-` fixtures (4 users `CORP E2E +1416…` and 4
residential accounts `CORP E2E resident …`) but its `tearDown` deletes only accounts named `CORP E2E — …`,
which matches **neither**. They persist in the **dev** database, and now appear in a developer's `/customers`
list. **Prod is clean** (4 real customers, verified above).

Cleaning them properly means deleting their orders, which sit behind append-only triggers — that is another
spec's contract and a risky, unrelated change. Flagged rather than broken.

---

## 7. Follow-ups

1. **§5 — the prod data fix.** Yours to authorise.
2. **Staff edit of a customer** (contact details, add an address on their behalf) — the deliberate v2 of this
   view. It would also need `AuditLog` writes and a stricter role gate.
3. **Console chat moderation** — still a separate, deliberate decision. Nothing here surfaces chat.
4. **Draw real service zones.** Until then every address on every 360 reads "Coverage not checked", which is
   honest but not useful.
5. **Step 2 — pickup scheduling** (real zone/capacity-aware time-slot picker, replacing the hard-coded
   "tomorrow morning" switch). PRD A2.1. Resumes the customer-app Tier-2 order.
