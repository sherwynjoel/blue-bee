-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "start_geo" geography(Point, 4326);

-- AlterTable
ALTER TABLE "RouteStop" ADD COLUMN     "exception_reason" TEXT;

-- CreateTable
CREATE TABLE "Manifest" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "route_id" UUID,
    "route_stop_id" UUID,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Manifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Manifest_org_id_idx" ON "Manifest"("org_id");

-- CreateIndex
CREATE INDEX "Manifest_route_id_idx" ON "Manifest"("route_id");

-- CreateIndex
CREATE INDEX "Manifest_route_stop_id_idx" ON "Manifest"("route_stop_id");

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_route_stop_id_fkey" FOREIGN KEY ("route_stop_id") REFERENCES "RouteStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

