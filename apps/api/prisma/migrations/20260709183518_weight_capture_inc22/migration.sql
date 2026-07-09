-- Increment 22 — Weight capture (append-only driver/plant weigh → hybrid pricing gate).
-- ADDITIVE ONLY: one new enum (WeighPoint) + one new append-only table (WeightCapture) + its indexes + the
-- append-only trigger. No ALTER, no data touched.
--
-- NOTE: `migrate diff` again emits three phantom `DROP INDEX` lines for the raw NULLS-NOT-DISTINCT
-- (ParLevel_/LinenStock) + PostGIS-GiST (ServiceZone_area_gist) indexes Prisma's schema can't express —
-- DELIBERATELY OMITTED here, exactly as every migration since Inc-19.

-- CreateEnum
CREATE TYPE "WeighPoint" AS ENUM ('PICKUP', 'PLANT');

-- CreateTable
CREATE TABLE "WeightCapture" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID,
    "weight_kg" DECIMAL(10,2) NOT NULL,
    "weigh_point" "WeighPoint" NOT NULL,
    "captured_by_user_id" UUID,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "WeightCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeightCapture_org_id_idx" ON "WeightCapture"("org_id");

-- CreateIndex
CREATE INDEX "WeightCapture_order_id_idx" ON "WeightCapture"("order_id");

-- CreateIndex
CREATE INDEX "WeightCapture_item_id_idx" ON "WeightCapture"("item_id");

-- CreateIndex
CREATE INDEX "WeightCapture_captured_at_idx" ON "WeightCapture"("captured_at");

-- Append-only enforcement (PRD §8.2/§8.6): block UPDATE/DELETE at the DB, reusing the same
-- bluebee_block_mutation() trigger function as CustodyEvent/AuditLog/LinenMovement. A weight capture is
-- immutable — a correction is a NEW capture (re-weigh), never an edit; the authoritative weight is the
-- most recent row. (Parent refs are scalar columns with no FK, so no cascade ever targets this ledger.)
CREATE TRIGGER weight_capture_append_only
  BEFORE UPDATE OR DELETE ON "WeightCapture"
  FOR EACH ROW EXECUTE FUNCTION bluebee_block_mutation();
