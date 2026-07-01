-- Increment 17 — Visual dry-clean item catalog (categorized, with images).
-- ADDITIVE + REVERSIBLE-SAFE ONLY: a new enum value, one new table, new nullable/defaulted columns on
-- Service, new indexes + one SET-NULL FK. No DROP, no data loss — every existing Service (wash&fold LB,
-- specialty ITEM/SQFT) keeps working untouched (category NULL, image NULL, active=true, sortOrder=0).
--
-- NOTE: a `migrate diff` against the live schema also emits two `DROP INDEX` lines for
-- `ParLevel_/LinenStock_site_cost_center_service_key`. Those are DELIBERATELY OMITTED (migration 14's raw
-- `NULLS NOT DISTINCT` unique indexes the Prisma `@@unique` can't express → a pre-existing phantom drift;
-- the linen on-hand `ON CONFLICT` upsert depends on them). This migration leaves that pattern untouched.

-- AlterEnum: the catalog item photo kind (only ADDED here; first used by the seed in a later tx).
ALTER TYPE "PhotoKind" ADD VALUE 'CATALOG';

-- AlterTable: Service — dry-clean catalog fields (all defaulted/nullable ⇒ existing rows unaffected).
ALTER TABLE "Service" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "category_id" UUID,
ADD COLUMN     "image_key" TEXT,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: ServiceCategory (org-scoped dry-clean category).
CREATE TABLE "ServiceCategory" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceCategory_org_id_idx" ON "ServiceCategory"("org_id");

-- CreateIndex
CREATE INDEX "Service_category_id_idx" ON "Service"("category_id");

-- AddForeignKey (SET NULL ⇒ deleting a category never deletes its items; they fall to uncategorized).
ALTER TABLE "Service" ADD CONSTRAINT "Service_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
