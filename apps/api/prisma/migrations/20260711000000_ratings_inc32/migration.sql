-- Increment 32 — Ratings / CSAT (PRD A6.3). Post-delivery customer rating.
-- ADDITIVE ONLY: one new table (Rating) + its indexes + the FK to Order. No ALTER, no data touched, no backfill.
--
-- NOTE: as with every migration since Inc-19, `migrate diff` emits phantom `DROP INDEX` lines for the raw
-- NULLS-NOT-DISTINCT (ParLevel_/LinenStock) + PostGIS-GiST (ServiceZone_area_gist) indexes Prisma's schema
-- can't express — DELIBERATELY OMITTED here.

-- CreateTable
CREATE TABLE "Rating" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "submitted_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rating_order_id_key" ON "Rating"("order_id");

-- CreateIndex
CREATE INDEX "Rating_org_id_idx" ON "Rating"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_org_id_order_id_key" ON "Rating"("org_id", "order_id");

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
