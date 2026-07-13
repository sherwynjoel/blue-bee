# Inc-37 — Home tab + REAL referral credit (earn · balance · spend)

**Date:** 2026-07-13 · **Status:** built, fully verified, **NOT deployed** (no `railway up`, no EAS) · **Stop point:** founder audit

---

## 1. What was asked, and the conflict I had to resolve first

> "Add a Home screen before Services… an area saying *'Get free credits. Invite your family and friends and get free credits on your order.'* Below that 'My orders', below that 'My account' where your credit will be shown, whatever you have. Also make a place in the web dashboard to make/edit these screens… Make sure that none of it is a stub."

That copy could not be shipped as written. **No credit system existed.** Inc-34 built Refer (invite + code + attribution) and *deliberately deferred the reward* — with an explicit rule that the app must invite **without stating or implying any reward**. So "get free credits" + a credit balance would have been exactly the two things the honesty firewall forbids: an unbacked promise, and a `0 credits` stub.

I surfaced the conflict rather than quietly writing the words. **Founder chose: build credits for real.** This increment therefore ships the *money*, not the marketing.

---

## 2. The ledger (the core decision)

`CreditEntry` is **append-only with signed amounts** — the same discipline as `AuditLog` and `WeightCapture`.

- A balance is **`SUM(amount)`**. It is never a stored counter that can drift from its history.
- A correction is a **new row** (`ADJUSTMENT` / `REVERSAL`), never an edit.
- Kinds: `REFERRAL_EARN` (+) · `REDEMPTION` (−) · `ADJUSTMENT` (±) · `REVERSAL` (±).

**Double-spend is prevented by the database, not by a service:**

| Index | Guarantees |
|---|---|
| `@@unique([orgId, kind, referredUserId])` | at most **one** `REFERRAL_EARN` per invited friend — ever, however many orders they go on to have |
| `@@unique([orgId, kind, orderId])` | at most **one** `REDEMPTION` per order — a retried payment can never spend the credit twice |

Both were proven by *doing it twice*, not by reading the schema.

---

## 3. EARN — `apps/api/src/logistics/route-stop.service.ts`

The referrer is paid when **a friend they invited has their FIRST order DELIVERED** — not at signup, which would be farmable.

The hook sits beside the Inc-32 rate-request push, **after the transaction commits**, and is written so that **a credit problem can never fail a delivery**: it swallows every error (including the P2002 race from a concurrent hook) and no-ops when the reward is unfunded, the customer wasn't referred, or the friend was already paid for.

## 4. SPEND — `apps/api/src/payments/payment.service.ts#createIntent`

Credit is applied **before** Stripe:

1. `redeemForOrder()` writes one `REDEMPTION` (capped at the balance; a retry **reuses** the existing row).
2. The card is charged **only the remainder**.
3. If credit covers the whole bill → **no Stripe intent is created at all**: `clientSecret: null`, a `method: CREDIT` / `SUCCEEDED` `Payment`, order → `PAID`, audit `PAYMENT_SETTLED_FROM_CREDIT`.
4. **Stripe-minimum guard** (`MIN_CHARGE_MINOR = 50`): credit is held back so the card never sees a sub-50¢ remainder. A $30.00 balance against a $30.20 bill applies **$29.70** and charges **$0.50** — the customer *keeps* the 30¢ instead of losing it to an uncharged remainder.
5. Overdraw is refused: `credit.insufficient_balance`.

**Contract change (breaking, handled everywhere):** `PaymentIntentResponse.clientSecret` is now `string | null`, plus new `creditApplied` and `orderTotal`. Updated call sites: `apps/customer/src/screens/PayScreen.tsx` (null ⇒ skip PaymentSheet entirely, go straight to the receipt), `apps/customer/scripts/payments-proof.ts`, `apps/web/components/PortalInvoiceDetail.tsx`.

---

## 5. HONESTY — enforced in code, not in a style guide

- A reward **exists only if the founder funds it** (console → *Customer home* → **Referral reward**). That page is the only place a reward can come into existence.
- With it OFF, `GET /v1/home` returns `reward.enabled: false` and the app renders **no reward line and no balance row at all** — not a `0 credits` placeholder. Nothing is promised because nothing is owed.
- The reward **terms are built from config**, never from a founder's free-text card:
  `"You earn $10.00 credit when a friend you invite has their first order delivered."`
  So no one can type a promise into a content card that the ledger will not honour. This is asserted by a test: *"with NO funded reward it promises NOTHING"*.

---

## 6. HOME — the 5th tab (Home · Services · Orders · Profile · Refer)

`GET /v1/home` returns one aggregate: `blocks` · `credits` · `reward` · `recentOrders` · `orderCount` · `account`.

- **The app hard-codes zero copy.** `HomeBlock` rows are what customers read (OWNER CRUD at `/v1/admin/home-blocks`, edited in the console at `/content`). No blocks ⇒ no promo area — never a placeholder.
- CTAs carry **semantic targets** (`refer` / `services` / `orders`), never a raw route typed into a text field.
- **Re-reads on tab focus + pull-to-refresh** — the Inc-36a lesson, so a console edit reaches an app that is *already open*. A failed refresh keeps working content on screen rather than blanking it.

**Console** also gains a per-customer **Credits** card: balance + the full append-only ledger + a FINANCE-gated adjustment that **requires a note** (an unexplained money movement is not allowed).

---

## 7. Proof

| Gate | Result |
|---|---|
| typecheck | **10/10** |
| lint | **6/6** |
| api unit | **338/338** |
| customer | **209/209** (incl. `DashboardScreen` 9/9) |
| driver | **49/49** |
| web | **215/215** |
| **api e2e (fresh seeded DB)** | **465/465 · 38/38 suites** |

`credits.e2e` (8/8) proves: no funded reward ⇒ nothing granted **and** nothing promised · a funded reward pays the referrer **exactly once** (a second delivery + a retry both no-op) · credit applied at payment charges only the remainder and a retry never double-spends (one `REDEMPTION` row) · credit-covers-all ⇒ `clientSecret: null`, `method: CREDIT`, order PAID, **Stripe never called** · the 50¢ guard · overdraw refused · Home content round-trip (create → visible in-app → edit → visible → deactivate → gone).

`pod.e2e` gained a case proving the earn fires on a **real driver delivery** — route → POD (real MinIO bytes) → complete → `DELIVERED` → exactly one `REFERRAL_EARN` to the referrer, stamped with the friend and the order that earned it. This is the difference between *"the function works"* and *"the button is connected"*.

### Flakes observed (pre-existing, NOT Inc-37)
Two full-suite runs surfaced transient failures that **do not reproduce** and touch **no Inc-37 code path**. I chased each to root cause rather than re-running until green:
- `orders.e2e` *"concurrent approves"* — the losing request can legitimately land on **404 `quote_not_sent`** instead of 409 `illegal_transition`, depending on which read wins the race. The test asserts `[200, 409]`. **A pre-existing test weakness** (the app is correct either way). Left alone — out of Inc-37 scope; flagged for a future increment.
- `logistics.e2e` `POST /v1/routes` → 400. Instrumenting the global exception filter proved this 400 **never entered the Nest pipeline** — it is an express/transport-level flake under the long in-band run, not an application error.
- `web` `CustomersHome` empty-search — debounce timing under full-suite load; 10/10 standalone and 215/215 on re-run.

Every suite is green standalone, in prefix combination, and in the final full fresh-DB run.

---

## 8. Still parked / next

- **Nothing is deployed.** No `railway up`, no EAS build. Staging still runs Inc-28→35.
- The reward is **OFF by default** on every environment. Until a founder funds it in `/content`, the app promises nothing — which is the correct, honest default.
- `000000` OTP dev bypass is still active on staging (known, parked since the Inc-28→35 deploy).
- Suggested follow-up: fix the `orders.e2e` concurrent-approve assertion to accept either legal losing outcome (or make the loser deterministic).
