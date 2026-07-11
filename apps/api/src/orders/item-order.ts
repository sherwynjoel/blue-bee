import type { Prisma } from '@prisma/client';

/**
 * [Inc-29] The ONE ordering for an order's items. Every read of `Order.items` — the customer app's order
 * detail, the console, the driver's manifest, the custody-event writers — sorts by this and nothing else.
 *
 * WHY IT EXISTS. `Item` had no ordinal and no `orderBy`, so Postgres returned an order's items in HEAP
 * order. Any UPDATE (an intake inspection, a plant weigh) can relocate a row to a different page, so two
 * reads of the same order could genuinely list its items in different sequences. A single exported constant,
 * rather than a literal repeated at each call site, is what stops one surface drifting from another.
 *
 * WHY THE `id` TIEBREAK. `sortOrder` is unique within an order for every row written since Inc-29 (it is the
 * submitted index). It is NOT guaranteed unique among the rows the Inc-29 backfill touched: where an order's
 * items shared a `created_at` millisecond, the backfill ranked them by `id`. `id` therefore closes the order
 * into a total one, so the sequence is identical on every read forever — including for those rows.
 *
 * Not applicable to Track-B resident garments (`orderId` is null; `sortOrder` stays 0). They are read by
 * `residentId` and ordered by `updatedAt` in `GarmentService`.
 */
export const ITEM_ORDER_BY = [{ sortOrder: 'asc' }, { id: 'asc' }] satisfies Prisma.ItemOrderByWithRelationInput[];
