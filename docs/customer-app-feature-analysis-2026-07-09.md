# Customer App — Competitive Feature Analysis (Laundryheap + Poplin)

**Date:** 2026-07-09
**Author:** Product (analysis session)
**Scope:** Blue Bee **customer app only**. Phase-1-vs-later tagged.
**Purpose:** Decide which screens/options/features from two reference consumer-laundry apps we should pull into Blue Bee, and what that implies for the backend we're about to wire further.
**Sources analysed:** 15 screenshots (Laundryheap UK, Poplin US) + Laundryheap Help Center, Poplin how-it-works, and 2026 home-services referral/quote-flow best-practice research (links at end).

---

## 0. The one framing insight (read this first)

**Both reference apps are consumer wash-and-fold businesses. Blue Bee Phase 1 is quote-based specialty cleaning.** That difference decides almost everything below.

- Laundryheap and Poplin sell a **commodity, per-unit, priced-upfront** service (per kg, per lb, per shirt). Their whole app is built to make repeat, predictable purchases frictionless: prepaid packs, subscriptions, wallets, instant checkout.
- Blue Bee Phase 1 sells **rugs, carpets, blinds, upholstery, garments** — **variable-measure, inspected-at-plant, quote-then-approve**. The final price is computed server-side after measurement, not shown upfront. Our marquee features are **live tracking, chain-of-custody, before/after photos, quote approval** — none of which the references even have.

So the rule for this whole document: **a reference feature is worth copying only if it survives the translation from "commodity per-unit" to "quoted specialty job."** Several of the most prominent reference features (prepaid packs, consumer subscriptions) do **not** survive that translation and are also explicitly out of our MVP (PRD §14.1: no consumer wash-fold, no subscription until Phase 4). We should not chase them because a competitor screenshot looks polished.

What DOES translate is the **connective tissue** every good services app has and ours is thin on today: trust signals, a proper "how it works," clean address capture, saved payment, an account hub, ratings, tips, and empty states.

---

## 1. Where our customer app stands today

**9 screens:** Login (phone-OTP) · Home (service grid) · Orders · Book · OrderDetail (timeline + quote approve/decline + before/after photos) · Track (live truck) · Chat (customer↔driver) · Pay (Stripe) · Settings.

**Bottom nav:** Home · Orders · [center Book FAB] · More (→ Settings).

**Catalog:** server-driven. Specialty item kinds `RUG · CARPET · BLIND · UPHOLSTERY · GARMENT` (unit + base rate + measure), plus a per-item dry-clean catalog. App shows an **estimate range only**; final quote is server-side after measurement.

**Order lifecycle (PRD §5.1):** `REQUESTED → SCHEDULED_PICKUP → PICKUP_EN_ROUTE → PICKED_UP → INTAKE_INSPECTED → QUOTED → QUOTE_APPROVED → IN_CLEANING → QC → READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED → INVOICED → CLOSED`, plus branch states (`QUOTE_DECLINED`, `DAMAGE_PREEXISTING_FLAGGED`, `ON_HOLD`, `REWASH`, `CLAIM_OPENED/RESOLVED`).

**Gaps the references immediately expose** (these are features the PRD already calls MVP but that aren't built on the customer surface yet):

| Gap | PRD ref | State |
|---|---|---|
| Add-a-new-address flow (booking only picks pre-seeded sites) | A1.2 | Not built |
| Saved / tokenized payment method on file | A1.2 | Not built (pay-per-order only) |
| Tip at payment | A5.1 | Not built |
| Rate & review after delivery | A6.3 | Not built |
| Raise a claim from the app (with photos) | A6.2 | Not built (only claim *states* render) |
| Profile edit / address management screen | A1.2 | Not built |
| Onboarding / "how it works" | — | Not built |
| Empty states, notification preferences | — | Thin |

**The references are most useful as a checklist for closing these gaps, not as a menu of new ideas.**

---

## 2. Screen-by-screen teardown → Blue Bee decision

### Laundryheap

| Reference screen / element | What it does | Blue Bee decision | Phase |
|---|---|---|---|
| **Home hero** — country selector, "Schedule your first order," trust badges (£20 min · free 24h delivery · best price guaranteed) | First-order confidence | **Adopt (light).** Replace with our real signals: service area (GTA), turnaround, and a re-clean/satisfaction guarantee. Cheap trust, high impact. | **P1** |
| **"Getting started? See how it works"** card | Explains the service | **Adopt.** *More* valuable for us than for them — our quote→approve→track flow is unfamiliar. A 3-step "Book → We measure & quote → You approve & track" removes first-order anxiety. Content-only. | **P1** |
| **Prices tab** — rich service cards (icon, description, process tags, "from £X") + trust footer | Browsable catalog | **Adopt.** This is *exactly* the deferred catalog wiring (description / features / icon). Our Home grid already renders `priceFrom`; give the cards real content. | **P1** |
| **Booking → Address** ("Detect location" / "Enter postcode manually") | Capture where the driver goes | **Adopt.** Fills the #1 gap — today we can't add a new address in-app. Detect + manual entry + geocode. | **P1** |
| **Prepaid packs** (Shop/My Packs, tiered kg/shirt packs, % off, POPULAR badge) | Prepay commodity volume | **Skip (now).** Wash-fold-specific. Our jobs are variable-measure quotes — you can't prepay "20 rugs" the way you prepay "20 shirts." Also collides with excluded consumer wash-fold (§14.1). The commercial analog (care-home/hotel volume) is a **contract/PO**, not a consumer pack — that's Phase 2/3. | **P2/P3 (different mechanism)** |
| **Laundryheap+ subscription** (skip service fee £3.99/mo) | Membership | **Skip (now).** Consumer subscription is explicitly **Phase 4** and §15 warns against subscription-creep in MVP. Commercial analog = service contract, later. | **P4** |
| **Promotion coupon** ("10% off Duvets") | Launch/seasonal offer | **Adopt later (light).** A simple voucher code for a launch offer is reasonable, but needs a promo entity + a credit/discount path we don't have. | **P1.5/P2** |
| **More hub** (Past/Repeat orders · My wallet · Subscriptions · Promotions · Refer a friend · Account · FAQ · Get help) | Account/utility hub | **Adopt the structure.** Reorganise Settings into a real hub. Keep the rows we support (Orders, Payment methods, Notifications, Account, Help/FAQ); defer wallet/subscriptions/referrals rows until modeled. | **P1** (structure) |
| **Repeat orders** | One-tap reorder | **Adopt later.** Strong retention lever once order history exists; low MVP priority. | **P1.5** |

### Poplin

| Reference screen / element | What it does | Blue Bee decision | Phase |
|---|---|---|---|
| **Onboarding carousel** ("Got laundry? Allow us," dots, Start order / Login) | Pre-login story | **Adopt later.** A single "how it works" is enough for MVP; a multi-slide carousel is polish. | **P1.5** |
| **Auth** (phone · Google · Email) | Sign in options | **Adopt.** Phone-OTP exists. Add **Apple + Google** (Apple sign-in is an App Store requirement if any social login exists; both are PRD A1 MVP). | **P1** |
| **Signup** (first/last name · mobile · **Personal / Business** · 65-or-over · ToS) | Account creation | **Adopt (selective).** The **Personal/Business toggle matters for us** — we're commercial-leaning (corporate pricing now, care homes/hotels later); routing business accounts early is valuable. **Drop the "65 or over"** (US-accessibility-specific to Poplin). | **P1** |
| **Push priming** ("Don't miss out on order updates") | Lift notification opt-in | **Adopt.** We already register push tokens; a priming screen before the OS prompt raises opt-in — and order updates are the core of our tracked-job experience. | **P1** |
| **Testimonial interstitial** ("game changer! – Alexandra") | Social proof | **Adopt later — honesty gate.** Only with *real* reviews. Do not ship fabricated testimonials (honesty firewall). Revisit once ratings exist. | **P2** |
| **Orders empty state** ("No orders to display" + Place an order) | Guide first action | **Adopt.** Trivial to build, meaningful UX lift. | **P1** |
| **Account hub** (Account Details · Preferred Laundry Pros · Profiles · Notifications · Payment Methods · Gift Cards · Referrals) | Account management | **Adopt selectively.** Yes: Account Details, Profiles, Notifications, **Payment Methods**. Defer: Gift Cards, Referrals (need wallet). Mostly N/A: **Preferred Laundry Pros** — Poplin is a *marketplace*; we own our fleet. A light "notes for your regular pickup" is the only analog, low priority. | **P1** (core rows) |
| **Ratings model** (Poplin's whole app is rating/tip-driven) | Quality loop | **Adopt.** Rate & review after `DELIVERED` (A6.3, MVP, currently unbuilt). | **P1** |

---

## 3. Feature recommendations, grouped

### A. Build now — closes promised MVP gaps (small, high-value)

These are already MVP in the PRD; the references just confirm they're table-stakes. Most need a modest backend addition.

1. **Catalog content** — add `description`, `features[]`, `icon` to service categories/services; expose in the catalog API; add a console admin to edit; seed **real CAD copy** for the services we actually offer. *(This is the catalog wiring already flagged as deferred — it's the single highest-leverage item and unblocks the Home/Prices cards.)*
2. **Add-address flow** — endpoint to create a new `Site` + geocode; "detect location" + manual entry in Book. Removes the pre-seeded-sites limitation.
3. **Saved payment method** — tokenized card on file (A1.2) so repeat booking isn't full card entry each time.
4. **Tip at payment** — tip field on the payment/order (A5.1).
5. **Rate & review** — review entity + endpoint, surfaced after `DELIVERED` (A6.3).
6. **Claim from app** — claim-creation endpoint with photos (A6.2); we already render claim states.
7. **Notification preferences** — per-channel (push/SMS/email) prefs on the account/device.

### B. Build now — structure & polish (mostly app-side, little/no backend)

8. **Account/More hub** reorg (Orders · Payment Methods · Notifications · Account · Help/FAQ).
9. **Orders empty state** + a **how-it-works** card + **trust signals** (real ones).
10. **Push-priming** screen before the OS prompt.
11. **Personal/Business** toggle at signup; **Apple + Google** sign-in.
12. **Help / FAQ / Get help** entry (route to chat/CSR).

### C. Defer — real growth levers, but need new data modeling

These are genuinely good (2026 research: **59% of home-services work comes from referrals/repeat**, and **non-cash incentives out-perform cash by ~24%**). But none are in our data model, and they share a dependency:

13. **Wallet / credit ledger** — the backbone. Nothing exists today except `CreditNote` for claims. Model this once, deliberately.
14. **Referrals** — needs the credit ledger + a referral entity. Highest-ROI of this group for a local services business; sequence it right after MVP stabilises.
15. **Promotions / vouchers** — launch offers; needs a promo/discount path.
16. **Gift cards** — stored-value + gifting; acquisition + revenue, but heaviest lift. Evaluate last.

**Sequence C as one epic** ("wallet + credits → referrals → promos → gift cards") so we don't build four half-ledgers.

### D. Do NOT build (wrong model or explicitly out of scope)

- **Prepaid packs** — wash-fold volume mechanic; doesn't fit variable-measure quotes; collides with excluded consumer wash-fold.
- **Consumer subscription / membership** — Phase 4; §15 explicitly warns against MVP creep.
- **Preferred Laundry Pros** — marketplace feature; we run an owned fleet.
- **"65 or over" toggle** — Poplin-specific; not our compliance need.
- **Fabricated testimonials** — honesty firewall.

---

## 4. What this means for the backend we're about to wire

Ordered for the "wire the backend a little further" session, smallest-useful first:

**P0 (do in this pass):**
- Catalog content fields (`description`, `features[]`, `icon`) + catalog API + console edit + real seed copy. *(#1 above — unblocks Home/Prices immediately.)*
- Add-`Site` endpoint + geocode. *(unblocks real booking)*

**P1 (next):**
- Saved payment method (tokenized) · Tip field · Review entity · Claim-create endpoint · Notification prefs.

**P2 (deliberate, separate epic — do not start piecemeal):**
- Wallet/credit ledger → referrals → promos → gift cards.

**Explicitly not now:** prepaid packs, subscription/membership, marketplace preferred-pro.

Every field/entity above must carry `org_id`, respect the append-only custody rule, and — for any seed copy — use **real services and real CAD prices, no invented data** (honesty firewall).

---

## 5. Guardrails applied in this analysis

- **Phase-1 discipline:** nothing in §Build-now contradicts PRD §14.1's MVP cut line; wash-fold packs and subscriptions are held to their real phases (P2/P3 contract mechanics, P4 subscription).
- **Honesty firewall:** no fabricated testimonials, counts, or seed data recommended.
- **Model fit over screenshot envy:** features are judged against our quote-based specialty model, not adopted because a competitor's screen looks finished.

---

## Sources

- [Laundryheap — Prepaid packs](https://help.laundryheap.com/en/articles/6265403-what-are-prepaid-packs)
- [Laundryheap — Laundryheap+ subscription](https://help.laundryheap.com/en/articles/8229252-what-is-the-laundryheap-subscription)
- [Laundryheap — Credits & Wallet](https://help.laundryheap.com/en/articles/11496582-laundryheap-credits-wallet)
- [Poplin — How it works](https://poplin.co/how-it-works)
- [Poplin — Laundry review, pricing 2026](https://whisklaundry.com/blog/poplin-laundry-review-pricing/)
- [QuoteIQ — Upholstery/rug cleaning software & quote-flow UX 2026](https://myquoteiq.com/top-8-softwares-for-upholstery-cleaning-businesses-in-2026/)
- [Jobber — customer referral program ideas (home services)](https://www.getjobber.com/academy/customer-referral-program-ideas/)
- [GetTheReferral — home-services referral metrics 2026](https://www.getthereferral.com/blog/10-referral-analytics-metrics-for-home-services-roi)
