-- CreateEnum
CREATE TYPE "RouteStopHandoff" AS ENUM ('DIRECT', 'CONCIERGE');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('PER_ORDER', 'BATCH_PERIODIC');

-- CreateEnum
CREATE TYPE "StandingOrderCadence" AS ENUM ('WEEKLY', 'BIWEEKLY');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "billing_mode" "BillingMode" NOT NULL DEFAULT 'PER_ORDER',
ADD COLUMN     "billing_net_days" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RouteStop" ADD COLUMN     "stop_kind" "RouteStopHandoff" NOT NULL DEFAULT 'DIRECT';

-- CreateTable
CREATE TABLE "StandingOrder" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "vertical" "OrderVertical" NOT NULL DEFAULT 'SPECIALTY',
    "cadence" "StandingOrderCadence" NOT NULL,
    "weekday" INTEGER NOT NULL,
    "pickup_window" JSONB NOT NULL,
    "concierge" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "StandingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandingOrderOccurrence" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "standing_order_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "order_id" UUID,
    "route_id" UUID,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "StandingOrderOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StandingOrder_org_id_idx" ON "StandingOrder"("org_id");

-- CreateIndex
CREATE INDEX "StandingOrder_account_id_idx" ON "StandingOrder"("account_id");

-- CreateIndex
CREATE INDEX "StandingOrder_active_next_run_at_idx" ON "StandingOrder"("active", "next_run_at");

-- CreateIndex
CREATE INDEX "StandingOrderOccurrence_org_id_idx" ON "StandingOrderOccurrence"("org_id");

-- CreateIndex
CREATE INDEX "StandingOrderOccurrence_order_id_idx" ON "StandingOrderOccurrence"("order_id");

-- CreateIndex
CREATE INDEX "StandingOrderOccurrence_route_id_idx" ON "StandingOrderOccurrence"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "StandingOrderOccurrence_standing_order_id_period_key_key" ON "StandingOrderOccurrence"("standing_order_id", "period_key");

-- AddForeignKey
ALTER TABLE "StandingOrder" ADD CONSTRAINT "StandingOrder_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingOrder" ADD CONSTRAINT "StandingOrder_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingOrder" ADD CONSTRAINT "StandingOrder_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingOrderOccurrence" ADD CONSTRAINT "StandingOrderOccurrence_standing_order_id_fkey" FOREIGN KEY ("standing_order_id") REFERENCES "StandingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
