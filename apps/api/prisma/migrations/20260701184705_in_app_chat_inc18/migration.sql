-- Increment 18 — In-app chat (customer ↔ driver, per active order, time-boxed).
-- ADDITIVE + REVERSIBLE-SAFE ONLY: one new nullable column + one new index on the (until now dormant)
-- Message table. No DROP, no data loss — Message had NO application consumer before Inc-18 (the model +
-- CommsChannel enum shipped early, unused), and read_at NULL simply means "unread", the correct default
-- for any pre-existing row. The message body/from/to/sent_at stay immutable; read_at is the only field
-- Inc-18 ever mutates after send.
--
-- NOTE: a `migrate diff` against the live schema also emits two `DROP INDEX` lines for
-- `ParLevel_/LinenStock_site_cost_center_service_key` (migration 14's raw NULLS-NOT-DISTINCT unique
-- indexes Prisma's @@unique can't express → a pre-existing phantom drift the linen on-hand ON CONFLICT
-- upsert depends on). Those are DELIBERATELY OMITTED here, exactly as every migration since — untouched.

-- AlterTable: Message — per-recipient read-state (nullable ⇒ existing rows = unread; body/sender immutable).
ALTER TABLE "Message" ADD COLUMN     "read_at" TIMESTAMP(3);

-- CreateIndex: order-scoped thread reads (history GET + unread count + mark-read) filter by order_id.
CREATE INDEX "Message_order_id_idx" ON "Message"("order_id");
