# Handoff — Inc-29: deterministic order-item ordering

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Branch:** `feature/s3-media-golive`
**App:** `apps/api` · **Status:** ✅ Built, migrated (dev), tested, **live-verified**, reverted. **Not deployed** (founder's call).
**Closes:** the correctness/mispricing risk flagged in the Inc-28 handoff §7.

> **If you read one thing, read §5.** It is the proof that the API returns submitted item order even after
> the rows have physically shuffled on disk — the exact regression this increment closes.

---

## 1. The bug, precisely

`FULL_INCLUDE.items` in `orders.service.ts` had **no `orderBy`**, and `Item` had no ordinal column. So an
order's items came back in **heap order**.

Heap order is not insertion order. An `UPDATE` writes a new tuple version, which Postgres places at the end
of the page's free space, so **an item that gets inspected or weighed moves to the end of any un-ordered
scan.** Two reads of the same order could therefore list its items in different sequences — on the customer
app, the console, and the driver's manifest — and an index-based consumer could bind a value to the wrong
line. (Inc-28's audit caught a rug's `{ sqft: 40 }` landing on a wash-and-fold garment; `quotes.build`
correctly refused to price the now-unmeasured rug line, 422.)

---

## 2. ⚑ Three corrections to the brief — each made the fix safer, not harder

Checked before writing a line.

1. **"All items in a booking share one transaction `createdAt`, so there's no tiebreak."** False. Prisma
   stamps `created_at` **per INSERT statement**, so `book()`'s per-item loop separates them by 2–12 ms. That
   inverts the honesty note in the brief: the backfill **recovers** the real submitted order almost
   everywhere, rather than merely imposing one. Measured on the dev DB (765 orders with items):

   | | orders | backfill result |
   |---|---:|---|
   | single item | 744 | trivially exact |
   | multi-item, distinct timestamps | 20 | **recovered** exactly |
   | multi-item, tied timestamps | **1** (`a6000000-…-0101`, a seeded `createMany`) | order **imposed** by uuid |

   So I do **not** call the backfill "restoring" order — for the one tie it imposes one, and the handoff says
   so. For the other 764 it recovers the truth.

2. **The brief's `PARTITION BY order_id` ignores that `Item.orderId` is NULLABLE.** 38 Track-B resident
   garments have no order. The backfill is scoped to `order_id IS NOT NULL`, so those keep the column default
   `0` — they are read by `resident_id`, ordered by `updatedAt`, bucketed by `garment_status`. Ranking them
   would have lumped every orderless garment in the org into one meaningless sequence.

3. **"Index-fragile consumers: quote build, the weigh mapping."** The **server** is not index-fragile:
   `quote.service` keys lines by `itemId`; `weigh.service` targets by `itemId` or errors on ambiguity. The
   only thing that ever bound by index was the **weigh e2e's test helper** (Inc-28 stopgap). Reported that
   plainly rather than inventing a server mispricing path.

---

## 3. The fix

**Schema** (`schema.prisma`): `Item.sortOrder Int @default(0) @map("sort_order")` + `@@index([orderId, sortOrder])`.

**Migration** `20260710213000_item_sort_order_inc29` — additive + reversible, runs in the boot-time
`prisma migrate deploy`:

```sql
ALTER TABLE "Item" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;         -- no rewrite failure

WITH ranked AS (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at, id) - 1)::int AS rn
  FROM "Item" WHERE order_id IS NOT NULL
)
UPDATE "Item" i SET sort_order = r.rn FROM ranked r WHERE i.id = r.id;

CREATE INDEX "Item_order_id_sort_order_idx" ON "Item"("order_id", "sort_order");
```

`Item` carries **no append-only trigger** (verified against the live catalog — those guard CustodyEvent /
AuditLog / WeightCapture / LinenMovement / ProcessedStripeEvent), so the backfill `UPDATE` is permitted.

**Write path.** `book()` sets `sortOrder` = the item's index in the **submitted** array (`dto.items.entries()`).
There is **no intake add-item endpoint** (grepped every `item.create`/`createMany`), and `orderId` is never
reassigned, so the value is write-once-correct. The seed's one two-item `createMany` now states
`sortOrder: 0, 1` explicitly rather than leaving that order to be imposed.

**Read path.** One exported constant, `ITEM_ORDER_BY = [{ sortOrder: 'asc' }, { id: 'asc' }]`
(`orders/item-order.ts`), applied to **every** `items` read:

- `FULL_INCLUDE.items` (the order detail — customer + console)
- both `manifest.service.ts` includes (the driver's load-sheet)
- the two custody-writer `item.findMany`s in `intake.service.ts` and `route-stop.service.ts` (so the
  PICKED_UP custody chain is written in the customer's item order)

A single constant, not a literal copied at five call sites — that duplication is precisely how one surface
comes to disagree with another. The `id` tiebreak makes the order **total** (it closes the tie for the one
backfilled order whose timestamps matched). `FULL_INCLUDE.lines` got the same `id` tiebreak.

---

## 4. Why the `id` tiebreak, concretely

`sortOrder` is unique within an order for every row written since Inc-29 (it is the submitted index). It is
**not** guaranteed unique among the rows the backfill touched: where an order's items tied on `created_at`,
they were ranked by `id` and the resulting `sortOrder` is still contiguous, but two future reads must agree
on it forever. `ORDER BY sort_order, id` guarantees that. Without the `id`, the single tied seed order could
in principle re-sort between reads.

---

## 5. Proof

### 5.1 `item-ordering.e2e-spec.ts` (new, 7 tests) — does not trust the bug, reproduces it

The load-bearing test **forces the heap to diverge and proves the API is immune**:

```
book 4 items [UPHOLSTERY, RUG, BLIND, CARPET]
  → physical order (ORDER BY ctid) == submitted            (fresh inserts)
inspect item[0]                                             (an UPDATE → new tuple → row moves)
  → physical order != submitted, and item[0] is now LAST on disk
  → API GET /v1/orders/:id still returns [UPHOLSTERY, RUG, BLIND, CARPET], sortOrder [0,1,2,3]
```

Plus: two-reads-identical; inspect-every-item-in-reverse still submitted order; the **driver manifest** lists
the same order the customer sees; backfill contiguity across the whole DB; resident garments still at 0.

Teardown disables the CustodyEvent append-only trigger **inside a transaction** (`ALTER TABLE` is
transactional, so any failure rolls the guard back on — it can never be left disabled) and re-enables it, so
the spec leaves **zero** dev-DB residue. (Contrast the Inc-27-flagged specs that leave orders behind.)

### 5.2 ⚑ The weigh e2e now PROVES the guarantee

Inc-28 had rewritten `bookToInspected` to map items by `kind` as a stopgap around this bug. **Restored** to
map `order.items[i]` by index — correct now, not lucky — and it asserts the returned kinds equal the
submitted kinds. An inspection in that helper mutates an item (moving its tuple), yet a later index read
still binds the right measurement to the right line, so **`weigh.e2e` passing is itself a proof.** No
assertion was weakened anywhere in the suite.

### 5.3 Live (localhost:3111, real dev DB, as real OWNER/CSR, then fully reverted)

```
book UPHOLSTERY,RUG,BLIND,CARPET → two reads identical, sortOrder 0,1,2,3
inspect item #0
  physical ctid order → RUG, BLIND, CARPET, UPHOLSTERY     ← the pre-Inc-29 bug, live
  API read            → UPHOLSTERY, RUG, BLIND, CARPET      ← unmoved
```

Proof order + items + tags + custody deleted (trigger toggled, confirmed back to `O`); whole-DB backfill
re-checked contiguous (0 broken); the other agent's `:3000` API left untouched.

---

## 6. Verification totals

| Suite | Before | After |
|---|---|---|
| api unit | 338 | 338 (unchanged) |
| api e2e | 411 | **418 / 418**, 33 suites (+7 `item-ordering.e2e-spec.ts`) — run **twice** back-to-back, identical |
| customer | 173 | 173 |
| web | 204 | 204 (one `CostCenters` `act()` flake under full-suite parallelism; green on re-run; touches no Inc-29 file) |

`tsc` clean across api · shared · customer · web. The clients define their own `ItemView` and consume the
already-ordered array, so nothing downstream needed a change. After the second full e2e run: CustodyEvent
trigger `enabled`, zero `ITEM ORDER E2E` residue.

---

## 7. Deploy

Additive column + backfill + index run via the boot-time `prisma migrate deploy` on the next `railway up` —
**inside the normal deploy path**, not manual DB surgery. Safe to batch with the Inc-28 deploy or ship right
after. Migration is idempotent (`prisma migrate status` = up to date; a re-deploy is a no-op).

**Not committed** (code only, per the standing pattern).

---

## 8. Follow-ups

1. **`Item.serviceWindows`'s cousin — `Site.serviceWindows`** (flagged Inc-28 §10.4): a `Json` column seeded
   in five places and read nowhere. Still there. Delete it or give it meaning.
2. **The one imposed order** (`a6000000-…-0101`): its two LINEN items are ordered by uuid, which happens to
   be 24-pieces-then-18. If the founder cares which is "first", it is a one-line seed edit. Not worth a
   migration.
3. **Optional tidy NOT done** (explicitly out of scope): the pre-existing customer lint failures on
   `ChatScreen.tsx` / `OrderDetailScreen.tsx` (unmodified from HEAD) remain.
4. **Deploy**, batched with Inc-28.
