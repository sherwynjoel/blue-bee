-- CreateEnum
CREATE TYPE "GarmentStatus" AS ENUM ('GARMENT_ENROLLED', 'SOIL_PICKUP', 'INTAKE_SORT', 'WASH', 'RETURN_SORT', 'DELIVERED_TO_RESIDENT', 'LOST_FOUND_POOL', 'RECONCILE');

-- CreateEnum
CREATE TYPE "ResidentStatus" AS ENUM ('ACTIVE', 'DISCHARGED');

-- CreateEnum
CREATE TYPE "LostFoundStatus" AS ENUM ('OPEN', 'RECONCILED');

-- AlterTable
ALTER TABLE "CustodyEvent" ADD COLUMN     "garment_stage" "GarmentStatus",
ALTER COLUMN "stage" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "garment_status" "GarmentStatus",
ADD COLUMN     "resident_id" UUID,
ALTER COLUMN "order_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Resident" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "room" TEXT,
    "status" "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Resident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostFoundItem" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "tag_id" UUID,
    "item_id" UUID,
    "candidate_resident_id" UUID,
    "status" "LostFoundStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "LostFoundItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resident_org_id_idx" ON "Resident"("org_id");

-- CreateIndex
CREATE INDEX "Resident_site_id_idx" ON "Resident"("site_id");

-- CreateIndex
CREATE INDEX "LostFoundItem_org_id_idx" ON "LostFoundItem"("org_id");

-- CreateIndex
CREATE INDEX "LostFoundItem_site_id_idx" ON "LostFoundItem"("site_id");

-- CreateIndex
CREATE INDEX "LostFoundItem_status_idx" ON "LostFoundItem"("status");

-- CreateIndex
CREATE INDEX "Item_resident_id_idx" ON "Item"("resident_id");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_candidate_resident_id_fkey" FOREIGN KEY ("candidate_resident_id") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
