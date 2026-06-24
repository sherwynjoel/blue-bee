-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "held_from" "OrderStatus";

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "item_id" UUID,
ADD COLUMN     "upcharges" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "adjustments" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "PriceList" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "account_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "account_override" DECIMAL(12,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceList_org_id_idx" ON "PriceList"("org_id");

-- CreateIndex
CREATE INDEX "PriceList_account_id_idx" ON "PriceList"("account_id");

-- CreateIndex
CREATE INDEX "PriceListItem_org_id_idx" ON "PriceListItem"("org_id");

-- CreateIndex
CREATE INDEX "PriceListItem_service_id_idx" ON "PriceListItem"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_price_list_id_service_id_key" ON "PriceListItem"("price_list_id", "service_id");

-- CreateIndex
CREATE INDEX "OrderLine_item_id_idx" ON "OrderLine"("item_id");

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

