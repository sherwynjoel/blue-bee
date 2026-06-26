-- CreateEnum
CREATE TYPE "CostCenterKind" AS ENUM ('WING', 'FLOOR', 'FUNDING', 'AMENITY', 'OTHER');

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "cost_center_id" UUID;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cost_center_id" UUID;

-- AlterTable
ALTER TABLE "StandingOrder" ADD COLUMN     "cost_center_id" UUID;

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CostCenterKind",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostCenter_org_id_idx" ON "CostCenter"("org_id");

-- CreateIndex
CREATE INDEX "CostCenter_account_id_idx" ON "CostCenter"("account_id");

-- CreateIndex
CREATE INDEX "CostCenter_site_id_idx" ON "CostCenter"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_account_id_code_key" ON "CostCenter"("account_id", "code");

-- CreateIndex
CREATE INDEX "InvoiceLine_cost_center_id_idx" ON "InvoiceLine"("cost_center_id");

-- CreateIndex
CREATE INDEX "Order_cost_center_id_idx" ON "Order"("cost_center_id");

-- CreateIndex
CREATE INDEX "StandingOrder_cost_center_id_idx" ON "StandingOrder"("cost_center_id");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingOrder" ADD CONSTRAINT "StandingOrder_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
