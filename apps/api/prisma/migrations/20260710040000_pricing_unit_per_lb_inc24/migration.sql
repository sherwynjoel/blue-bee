-- [Inc-24] AlterEnum (additive, non-breaking) — the per-pound wash & fold service-card unit.
--
-- Weight stays CAPTURED in kilograms (WeightCapture.weightKg); a PER_LB card converts kg → lb once, at
-- pricing time (packages/shared `kgToLb`). No column, index or data is touched, so this is safe to replay.
--
-- NOTE: Postgres forbids USING a new enum value in the same transaction that adds it. This migration only
-- ADDs the label (nothing reads/writes 'PER_LB' here), so it applies cleanly inside Prisma's migration
-- transaction. Per the Inc-19 convention this file is hand-written: the phantom `DROP INDEX` lines Prisma
-- emits for the raw NULLS-NOT-DISTINCT + PostGIS-GiST indexes are deliberately NOT included.
ALTER TYPE "PricingUnit" ADD VALUE 'PER_LB';
