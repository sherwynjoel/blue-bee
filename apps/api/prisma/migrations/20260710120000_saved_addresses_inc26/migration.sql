-- Increment 26 — Saved addresses (customer add / manage / pick).
-- ADDITIVE + REVERSIBLE ONLY: five new columns on "Site" (all with defaults or nullable), two new
-- indexes. No DROP, no data loss, no rewrite of existing rows.
--
-- Backfill semantics for the existing rows:
--   • unit / buzzer / notes → NULL (unknown, never invented).
--   • is_default            → false. No existing site is silently promoted to an account default;
--                             the first address a customer saves (or explicitly marks) becomes it.
--   • active                → true. Every pre-existing site stays visible and bookable.

-- AlterTable: Site — customer-managed delivery details + default flag + soft delete.
ALTER TABLE "Site" ADD COLUMN     "unit" TEXT;
ALTER TABLE "Site" ADD COLUMN     "buzzer" TEXT;
ALTER TABLE "Site" ADD COLUMN     "notes" TEXT;
ALTER TABLE "Site" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Site" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- ───────────────────────── Blue Bee custom migration steps ─────────────────────────
-- Appended to the Prisma-generated DDL above (things Prisma's schema language cannot express).

-- "At most one default address per account" as a DATABASE invariant, not an application convention.
-- Partial (WHERE-filtered) unique index: only ACTIVE defaults collide, so deactivating yesterday's
-- default never blocks promoting today's, and any number of non-default sites coexist.
CREATE UNIQUE INDEX "Site_one_default_per_account"
  ON "Site" ("account_id")
  WHERE "is_default" AND "active";

-- Spatial GiST index on the site point. Site.geo is a Prisma `Unsupported` geography column, so Prisma
-- cannot emit an index for it. Two hot paths scan it: the Inc-15 corporate building-match
-- (ST_DWithin(geo, point, match_radius_m)) and the Inc-26 saved-address reads. Mirrors the
-- hand-authored "ServiceZone_area_gist" from the Inc-19 geo-blocking migration.
CREATE INDEX "Site_geo_gist" ON "Site" USING gist ("geo");
