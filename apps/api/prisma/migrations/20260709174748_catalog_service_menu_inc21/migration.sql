-- Increment 21 — Catalog service menu (the 8 top-level Home service cards + pricing model).
-- ADDITIVE ONLY: two new enums (PricingModel, PricingUnit), one additive ServiceUnit value (KG), and five
-- additive, nullable/defaulted ServiceCategory columns + a self-referencing parent_id (Dry Cleaning → garment
-- sub-catalog) with its index + FK. No data touched — every existing Service/ServiceCategory row is untouched
-- (pricing_model defaults FIXED, unit defaults PER_ITEM, price_from NULL, currency 'CAD', parent_id NULL).
--
-- NOTE: `migrate diff` against the live schema also emits three phantom `DROP INDEX` lines for
-- `ParLevel_/LinenStock_site_cost_center_service_key` (migration 14's raw NULLS-NOT-DISTINCT unique indexes the
-- linen on-hand ON CONFLICT upsert depends on) and `ServiceZone_area_gist` (Inc-19's raw PostGIS GiST index) —
-- raw-SQL indexes Prisma's schema can't express. Those are DELIBERATELY OMITTED here, exactly as every
-- migration since Inc-19 — untouched.

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FIXED', 'FROM_MEASURED');

-- CreateEnum
CREATE TYPE "PricingUnit" AS ENUM ('PER_ITEM', 'PER_KG', 'PER_MEASURE');

-- AlterEnum (additive — the consumer Wash & Fold per-kg backing rate unit)
ALTER TYPE "ServiceUnit" ADD VALUE 'KG';

-- AlterTable — additive service-menu presentation + pricing columns on ServiceCategory
ALTER TABLE "ServiceCategory" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'CAD',
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "price_from" DECIMAL(12,2),
ADD COLUMN     "pricing_model" "PricingModel" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "unit" "PricingUnit" NOT NULL DEFAULT 'PER_ITEM';

-- CreateIndex
CREATE INDEX "ServiceCategory_parent_id_idx" ON "ServiceCategory"("parent_id");

-- AddForeignKey (self-relation; SET NULL so a child never cascades away — falls back to top-level)
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
