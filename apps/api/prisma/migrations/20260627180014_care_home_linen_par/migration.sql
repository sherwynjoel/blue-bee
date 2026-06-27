-- CreateEnum
CREATE TYPE "LinenMovementType" AS ENUM ('SOIL_PICKUP', 'DELIVERY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ManifestKind" AS ENUM ('PICKUP_CHECKLIST', 'PACK_TO_PAR');

-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN     "cost_center_id" UUID,
ADD COLUMN     "kind" "ManifestKind" NOT NULL DEFAULT 'PICKUP_CHECKLIST',
ADD COLUMN     "site_id" UUID;

-- CreateTable
CREATE TABLE "ParLevel" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "cost_center_id" UUID,
    "service_id" UUID NOT NULL,
    "target_qty" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "ParLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinenStock" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "cost_center_id" UUID,
    "service_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "LinenStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinenMovement" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "cost_center_id" UUID,
    "service_id" UUID NOT NULL,
    "type" "LinenMovementType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "actor_id" UUID,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "LinenMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoilPickup" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "cost_center_id" UUID,
    "route_stop_id" UUID,
    "cart_count" INTEGER NOT NULL,
    "bag_count" INTEGER,
    "weight_kg" DECIMAL(10,2),
    "soiled" BOOLEAN NOT NULL DEFAULT true,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "actor_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "SoilPickup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParLevel_org_id_idx" ON "ParLevel"("org_id");

-- CreateIndex
CREATE INDEX "ParLevel_account_id_idx" ON "ParLevel"("account_id");

-- CreateIndex
CREATE INDEX "ParLevel_site_id_idx" ON "ParLevel"("site_id");

-- CreateIndex
CREATE INDEX "ParLevel_cost_center_id_idx" ON "ParLevel"("cost_center_id");

-- CreateIndex
CREATE INDEX "ParLevel_service_id_idx" ON "ParLevel"("service_id");

-- CreateIndex
CREATE INDEX "LinenStock_org_id_idx" ON "LinenStock"("org_id");

-- CreateIndex
CREATE INDEX "LinenStock_account_id_idx" ON "LinenStock"("account_id");

-- CreateIndex
CREATE INDEX "LinenStock_site_id_idx" ON "LinenStock"("site_id");

-- CreateIndex
CREATE INDEX "LinenStock_cost_center_id_idx" ON "LinenStock"("cost_center_id");

-- CreateIndex
CREATE INDEX "LinenStock_service_id_idx" ON "LinenStock"("service_id");

-- CreateIndex
CREATE INDEX "LinenMovement_org_id_idx" ON "LinenMovement"("org_id");

-- CreateIndex
CREATE INDEX "LinenMovement_account_id_idx" ON "LinenMovement"("account_id");

-- CreateIndex
CREATE INDEX "LinenMovement_site_id_idx" ON "LinenMovement"("site_id");

-- CreateIndex
CREATE INDEX "LinenMovement_cost_center_id_idx" ON "LinenMovement"("cost_center_id");

-- CreateIndex
CREATE INDEX "LinenMovement_service_id_idx" ON "LinenMovement"("service_id");

-- CreateIndex
CREATE INDEX "LinenMovement_source_type_source_id_idx" ON "LinenMovement"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "SoilPickup_org_id_idx" ON "SoilPickup"("org_id");

-- CreateIndex
CREATE INDEX "SoilPickup_account_id_idx" ON "SoilPickup"("account_id");

-- CreateIndex
CREATE INDEX "SoilPickup_site_id_idx" ON "SoilPickup"("site_id");

-- CreateIndex
CREATE INDEX "SoilPickup_cost_center_id_idx" ON "SoilPickup"("cost_center_id");

-- CreateIndex
CREATE INDEX "SoilPickup_route_stop_id_idx" ON "SoilPickup"("route_stop_id");

-- CreateIndex
CREATE INDEX "SoilPickup_occurred_at_idx" ON "SoilPickup"("occurred_at");

-- CreateIndex
CREATE INDEX "Manifest_site_id_idx" ON "Manifest"("site_id");

-- CreateIndex
CREATE INDEX "Manifest_cost_center_id_idx" ON "Manifest"("cost_center_id");

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParLevel" ADD CONSTRAINT "ParLevel_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParLevel" ADD CONSTRAINT "ParLevel_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParLevel" ADD CONSTRAINT "ParLevel_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParLevel" ADD CONSTRAINT "ParLevel_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinenStock" ADD CONSTRAINT "LinenStock_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinenStock" ADD CONSTRAINT "LinenStock_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinenStock" ADD CONSTRAINT "LinenStock_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinenStock" ADD CONSTRAINT "LinenStock_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilPickup" ADD CONSTRAINT "SoilPickup_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilPickup" ADD CONSTRAINT "SoilPickup_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilPickup" ADD CONSTRAINT "SoilPickup_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilPickup" ADD CONSTRAINT "SoilPickup_route_stop_id_fkey" FOREIGN KEY ("route_stop_id") REFERENCES "RouteStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────── hand-authored (beyond Prisma's generator) ───────────────────────────

-- (1) Par + on-hand uniqueness per (site, cost-centre?, sku). NULLS NOT DISTINCT (PG15+) so a site-level
--     row (NULL cost_center_id) collides as a single value — exactly ONE par / ONE stock per key, and the
--     index the atomic on-hand upsert infers in `ON CONFLICT (site_id, cost_center_id, service_id)`.
CREATE UNIQUE INDEX "ParLevel_site_cost_center_service_key"
  ON "ParLevel" ("site_id", "cost_center_id", "service_id") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "LinenStock_site_cost_center_service_key"
  ON "LinenStock" ("site_id", "cost_center_id", "service_id") NULLS NOT DISTINCT;

-- (2) Append-only enforcement (PRD §8.2/§8.6 — the custody/ledger rule applied to linen stock). The
--     LinenMovement ledger is tamper-evident: block UPDATE/DELETE at the DB, reusing the same
--     bluebee_block_mutation() trigger function as CustodyEvent/AuditLog/ProcessedStripeEvent. (Parent
--     refs are scalar columns with no FK, so no cascade ever targets the ledger — the trigger only ever
--     refuses a direct, mistaken mutation.)
CREATE TRIGGER linen_movement_append_only
  BEFORE UPDATE OR DELETE ON "LinenMovement"
  FOR EACH ROW EXECUTE FUNCTION bluebee_block_mutation();
