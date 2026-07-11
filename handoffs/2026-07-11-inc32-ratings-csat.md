# Handoff — Inc-32: Ratings / CSAT + rate-request push (PRD A6.3)

**Date:** 2026-07-11 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Branch:** `feature/s3-media-golive`
**Apps:** `apps/api` + `apps/web` + `apps/customer` · **Status:** ✅ Built, migrated (dev), tested. **Not committed. NOT deployed.**
**Arc:** the LAST increment of Step 3 (Inc-30 production → Inc-31 delivery → **Inc-32 ratings**). Also Inc-32 of the customer-app IA arc. Gates on the now-real `DELIVERED` (Inc-31).

> **If you read one thing, read §5** — the proof matrix (what's asserted exactly vs. real-and-sane, and why, on a persistent shared dev DB).

---

## 1. What shipped

- **Schema** — new `Rating` (`id, orgId, orderId, score Int, comment String?, submittedByUserId`, house cols). One per order. Migration `20260711000000_ratings_inc32` (CREATE TABLE + indexes + FK, no backfill), hand-written and applied via `prisma migrate deploy` (safe on the shared DB — never resets; table/indexes/FK verified).
- **Shared** (`ratings.ts`) — `createRatingSchema` / `patchRatingSchema` / `RatingView` / `RATING_ERRORS`, and the single eligibility source `RATEABLE_ORDER_STATUSES` + `isOrderRateable()` (DELIVERED-or-later). Plus `NOTIFICATION_EVENTS.RATE_REQUEST` and `AccountScorecard.avgRatingScore`.
- **API** (`ratings/` module) — `POST/PATCH/GET /v1/orders/:id/rating`. Write roles `RESIDENTIAL_CUSTOMER, ACCOUNT_ADMIN`; GET adds `OWNER, CSR` (console). Idempotency-keyed. Eligibility (409 `order_not_rateable`), scope/ownership via `requireOrderForWrite` (403 cross-account / 404 cross-org), one-per-order (409 `rating.already_exists`), PATCH original-submitter-only within 30 days.
- **Push** — `RATE_REQUEST` template + matrix row (`PUSH, EMAIL`) + `NotificationService.dispatchRateRequest` (mirrors `dispatchPayment`: recipients → matrix → prefs/quiet-hours → idempotent outbox row, isolated). Fired from the `DELIVERED` transition.
- **Analytics** — `csat` flipped `deferred → metric()` (avg score, org-scoped); `accountScorecard` gains `avgRatingScore`, surfaced in the web `AccountDetail` scorecard (existing `Stat`, honours the `Metric` wrapper).
- **Customer app** — `submitRating`/`updateRating`/`getRating`; `rating` in `FULL_INCLUDE` + the list include; `isRateable`/`alreadyRated`; `RateScreen` (stars + comment, read-only when rated); CTA on `OrderDetailScreen` after the timeline + a rate/score chip on the delivered `OrderCard`; `Rate` registered in both nav param lists + the stack.

---

## 2. ⚑ Key decisions (flagged, not silent)

1. **Rating modeled 1:1** (`orderId @unique`) so `getOrder`'s `FULL_INCLUDE` returns a singular `rating` (the brief wants `rating`, not `ratings[]`). `@@unique([orgId, orderId])` is kept for the org_id-on-every-constraint convention — functionally redundant (order id is a global uuid) but honours the house rule.
2. **The RATE_REQUEST push fires AFTER the tx commits, not inside `deliveryCompleteLeg`.** The leg RETURNS the delivered order id; `run()` enqueues the push after the `$transaction` (exactly where the realtime teardown already sits). Why: the notification engine inserts on its OWN connection (`this.prisma`, not the tx), so enqueuing inside the tx would orphan the row if the tx rolled back — and a rolled-back delivery must never fire a "how did we do?" push. This is the honest reading of the brief's "enqueue from the DELIVERED transition."
3. **`rating` added to the order LIST include too** (additive) — so a delivered `OrderCard` shows the score or the Rate CTA without a per-row fetch. Other consumers (web list) ignore the extra field.
4. **Frozen contract honoured** (`apps/customer/UX-REDESIGN-BRIEF.md §1`): every customer change is ADDITIVE — new client methods, a new `rating` field on the response types, a new `Rate` param/screen. No existing `client.*` signature or nav param SHAPE changed.
5. **Eligibility window = delivered-or-later** (DELIVERED/INVOICED/CLAIM_*/CLOSED), not `=== DELIVERED` — an invoiced order is still rateable.

---

## 3. Reuse (no new machinery)

- Scope/ownership: the SAME `OrderAccessService.requireOrderForWrite` gate the intake/quote/production/delivery surfaces use.
- Push: the SAME outbox engine (matrix / preferences / quiet-hours / idempotent `insertOnce`) as geofence + payment alerts — `dispatchRateRequest` is a third sibling of `dispatchGeofence`/`dispatchPayment`.
- Eligibility: ONE shared `isOrderRateable()` for the API gate AND the app CTA.
- Analytics: the existing `metric()` wrapper (degrades to `status:'error'`, never a 500) + the web `Stat` component (real / unavailable / error).

---

## 4. Endpoints + error codes

| Method | Route | Roles | Notes |
|---|---|---|---|
| POST | `/v1/orders/:id/rating` | RESIDENTIAL_CUSTOMER, ACCOUNT_ADMIN | 201; idempotency-keyed; 409 `order_not_rateable` / `rating.already_exists` |
| PATCH | `/v1/orders/:id/rating` | RESIDENTIAL_CUSTOMER, ACCOUNT_ADMIN | original submitter ≤30d; 403 `rating.not_yours` / 409 `rating.edit_window_closed` |
| GET | `/v1/orders/:id/rating` | + OWNER, CSR | 404 `rating.not_found` when unrated |

Cross-account → 403 `cross_account_forbidden`; cross-org/nonexistent → 404 `order_not_found`; staff write → 403 `forbidden_role`.

---

## 5. Verification (proof)

- Migration applied to dev DB; `Rating` table + `order_id`/`(org_id,order_id)` unique + `org_id` index + FK verified in psql.
- `packages/shared` rebuilt; **api / web / customer `tsc` all clean**.
- **`ratings.e2e-spec.ts` (new) — 6/6:** create → 201 + scoped row + embedded on `getOrder` & GET; before-DELIVERED → 409 `order_not_rateable` (and INVOICED IS rateable); dup → 409 + same-key idempotent replay; PATCH by submitter → 200, by a foreign submitter → 403 `rating.not_yours`; ACCOUNT_ADMIN rates own (201), rita cross-account → 403, cross-org → 404, OWNER/CSR → 403; analytics avg.
- **`pod.e2e` extended:** on the real POD-gated DELIVERED, a `rating.request` Notification is enqueued for the owning customer.
- **`analytics.e2e` updated:** `csat` + `avgRatingScore` assertions flipped from `unavailable_in_phase_1` → real (`status:'ok'`).
- **FULL api e2e: 426 → 432/432 (35 suites)**, `--runInBand --forceExit` — zero regressions.
- **web 213/213** (+ AccountDetail/AnalyticsHome avgRating fixtures); **customer 180/180** (+ `RateScreen.test` 4, `OrderDetailScreen.test` +3 CTA cases).

⚑ **Honest coverage notes on the persistent dev DB:** the account-scorecard average is asserted EXACTLY on a FRESH account (isolates from prior runs' ratings); the org-wide commercial CSAT is asserted real-and-sane (ok, 1–5, rowCount ≥ added), not an exact value it can't own. The PATCH-not-yours 403 is proven via a seeded foreign-submitter rating (the seed has no two rating-eligible users on one account). Channel-suppression reuses the proven `decideChannel` path.

---

## 6. Deploy (after the arc is audited)

ONE batched `railway up` (api + web) covering **Inc-28/29/30/31/32** (migrations run at boot via `prisma migrate deploy`) + ONE customer EAS rebuild (RateScreen + CTAs + the Inc-28 pending screens reach phones at once). **Nothing here is committed or deployed.** Roll the "delivery live + ratings" milestone up to `Projects/CHANGELOG.md` `[BLUE BEE]` at that point.

---

## 7. Files touched

```
apps/api/prisma/{schema.prisma, migrations/20260711000000_ratings_inc32/migration.sql (new)}
packages/shared/src/{ratings.ts (new), notifications.ts, analytics.ts, index.ts}
apps/api/src/ratings/{ratings.module.ts, ratings.controller.ts, ratings.service.ts} (new)
apps/api/src/{app.module.ts, orders/orders.service.ts,
              notifications/{notification.service.ts, notification-templates.ts}, config/notifications.config.ts,
              logistics/{logistics.module.ts, route-stop.service.ts}, analytics/analytics.service.ts}
apps/api/test/{ratings.e2e-spec.ts (new), pod.e2e-spec.ts, analytics.e2e-spec.ts}
apps/web/components/{AccountDetail.tsx, AccountDetail.test.tsx, AnalyticsHome.test.tsx}
apps/customer/{App.tsx, src/navigation.ts, src/api/{customer-client.ts, types.ts},
               src/orders/rating.ts (new), src/components/StarRating.tsx (new),
               src/screens/{RateScreen.tsx (new), RateScreen.test.tsx (new), OrderDetailScreen.tsx, OrderDetailScreen.test.tsx, OrdersScreen.tsx},
               src/orders/quote.test.ts, src/pay/payment-controller.test.ts, src/screens/PayScreen.test.tsx  (fixture: rating:null)}
CHANGELOG.md
handoffs/2026-07-11-inc32-ratings-csat.md (this file)
```

---

## 8. For the audit chat

The delivery→ratings arc (Inc-30/31/32) is complete and green end-to-end. `DELIVERED` is real (Inc-31, POD-gated), it fires a `RATE_REQUEST`, the customer rates from the app, and the score surfaces in console analytics + the account scorecard. Nothing is deployed — the whole arc batches into one `railway up` + one EAS build after this audit. The IA arc continues at **Inc-33** (the 4-tab nav shell + editable Profile), which is independent of ratings.
