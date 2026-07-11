-- Increment 29 — deterministic order-item ordering.
--
-- ADDITIVE + REVERSIBLE ONLY: one new column on "Item" (NOT NULL with a default, so no rewrite failure and
-- no downtime), one new index, one bounded backfill UPDATE. No DROP, no data loss, no column rewrite.
--
-- WHY. `Item` had no ordinal and the `items` include had no `ORDER BY`, so an order's items came back in
-- Postgres HEAP order. Any UPDATE (an intake inspection, a plant weigh) can relocate a row to a new page,
-- so two reads of the same order could list its items differently — on the customer app, the console, and
-- the driver's manifest. `created_at` is not a substitute: Prisma stamps it per INSERT statement, so it
-- usually separates items by a few milliseconds, but it TIES when two rows land in the same millisecond or
-- arrive through a single `createMany`.
--
-- "Item" carries NO append-only trigger (those guard "CustodyEvent", "AuditLog", "WeightCapture",
-- "LinenMovement" and "ProcessedStripeEvent"), so the backfill UPDATE below is permitted. Verified against
-- the live catalog before this migration was written.
--
-- BACKFILL SEMANTICS — read this before believing the numbers.
--   • Items are ranked WITHIN THEIR ORDER by (created_at, id). Because Prisma stamps `created_at` per
--     statement, that ordering RECOVERS the real submitted order wherever the timestamps differ.
--   • Where they TIE (same millisecond, or one `createMany`), the rank falls back to `id` — a uuid. That is
--     an order we IMPOSE, not one we recover: the original sequence was never stored, and this migration
--     does not pretend to know it. It is stable from here on, which is the whole point.
--   • Measured on the dev database at authoring time: 765 orders carry items — 744 hold a single item
--     (trivially exact), 20 multi-item orders have fully distinct timestamps (recovered exactly), and
--     exactly 1 (`a6000000-0000-4000-8000-000000000101`, a seeded `createMany` of two LINEN items) ties and
--     therefore receives an imposed order. Nothing is re-priced: existing quotes are stored rows and are
--     untouched by this migration.
--   • Items with a NULL `order_id` are Track-B resident garments. They belong to a RESIDENT, not an order,
--     are read by `resident_id` and bucketed by `garment_status`, and are deliberately left at the default
--     0. Ranking them would partition every orderless garment in the org into one meaningless sequence.

-- AlterTable: Item — the 0-based position of an item within its order.
ALTER TABLE "Item" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- ───────────────────────── Blue Bee custom migration steps ─────────────────────────
-- Appended to the Prisma-generated DDL above (things Prisma's schema language cannot express).

-- Backfill: rank each order's items by (created_at, id) and write a contiguous 0-based sequence.
-- Scoped to `order_id IS NOT NULL` so resident garments keep the column default.
WITH ranked AS (
  SELECT
    "id",
    (ROW_NUMBER() OVER (PARTITION BY "order_id" ORDER BY "created_at" ASC, "id" ASC) - 1)::int AS rn
  FROM "Item"
  WHERE "order_id" IS NOT NULL
)
UPDATE "Item" AS i
SET "sort_order" = r.rn
FROM ranked AS r
WHERE i."id" = r."id";

-- Serves the ordered read. Every `items` include is now `ORDER BY sort_order, id` beneath an `order_id`
-- filter, so this composite index answers it without a sort node.
CREATE INDEX "Item_order_id_sort_order_idx" ON "Item"("order_id", "sort_order");
