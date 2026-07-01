-- Increment 19 — Geo-blocking (owner-drawn service zones + out-of-area demand capture).
-- ADDITIVE ONLY: two brand-new tables (ServiceZone, CoverageRequest) + their indexes. No ALTER, no DROP of
-- any existing object, no data touched — every pre-existing order/site/account row is untouched. The
-- geography(Polygon,4326) / geography(Point,4326) columns are Prisma `Unsupported` (set/read via raw SQL:
-- ST_GeomFromGeoJSON / ST_AsGeoJSON / ST_Covers / ST_MakePoint), exactly like Site.geo. PostGIS is already
-- enabled by migration 1 (init_phase1) — not re-created here.
--
-- NOTE: a `migrate diff` against the live schema also emits two `DROP INDEX` lines for
-- `ParLevel_/LinenStock_site_cost_center_service_key` (migration 14's raw NULLS-NOT-DISTINCT unique indexes
-- Prisma's @@unique can't express → a pre-existing phantom drift the linen on-hand ON CONFLICT upsert depends
-- on). Those are DELIBERATELY OMITTED here, exactly as every migration since — untouched.

-- CreateTable: ServiceZone — an owner-drawn polygon service area (org-scoped; `area` is real geography).
CREATE TABLE "ServiceZone" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "area" geography(Polygon, 4326),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "ServiceZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CoverageRequest — the captured out-of-zone demand (attempted point + address + requester).
CREATE TABLE "CoverageRequest" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "address" TEXT,
    "point" geography(Point, 4326),
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "CoverageRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceZone_org_id_idx" ON "ServiceZone"("org_id");

-- CreateIndex
CREATE INDEX "CoverageRequest_org_id_idx" ON "CoverageRequest"("org_id");

-- CreateIndex
CREATE INDEX "CoverageRequest_user_id_idx" ON "CoverageRequest"("user_id");

-- CreateIndex
CREATE INDEX "CoverageRequest_org_id_created_at_idx" ON "CoverageRequest"("org_id", "created_at");

-- Spatial GiST index on the zone polygon so the booking-time ST_Covers containment check is index-accelerated
-- (hand-authored below the divider: Prisma cannot emit an index for an `Unsupported` geography column).
CREATE INDEX "ServiceZone_area_gist" ON "ServiceZone" USING gist ("area");
