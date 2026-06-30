-- Increment 15 — Corporate accounts + per-account rate cards + building-match pricing
-- (members pay individually). ADDITIVE + REVERSIBLE ONLY: new nullable columns / defaults, one new
-- table, two new enums, new indexes + FKs. No DROP, no data loss, no change to existing rows.
--
-- NOTE: a `migrate diff` against the live schema also emits two `DROP INDEX` lines for
-- `ParLevel_/LinenStock_site_cost_center_service_key`. Those are DELIBERATELY OMITTED here — migration
-- 14 created them as raw `NULLS NOT DISTINCT` unique indexes (which the Prisma `@@unique` cannot express,
-- hence the perpetual phantom drift); the linen on-hand atomic upsert's `ON CONFLICT` depends on them.
-- This migration is purely additive and leaves that pre-existing pattern untouched.

-- CreateEnum
CREATE TYPE "CorporateMembershipStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "CorporateMembershipSource" AS ENUM ('JOIN_CODE', 'BUILDING');

-- AlterTable: Account — corporate-pricing marker + per-account join code (the TTC path).
ALTER TABLE "Account" ADD COLUMN     "corporate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "join_code" TEXT,
ADD COLUMN     "join_code_expires_at" TIMESTAMP(3);

-- AlterTable: Order — effective pricing account (NULL ⇒ priced on the payer's own `account_id`).
ALTER TABLE "Order" ADD COLUMN     "pricing_account_id" UUID;

-- AlterTable: Site — building-match radius (metres). With `geo`, the corporate building boundary.
ALTER TABLE "Site" ADD COLUMN     "match_radius_m" INTEGER;

-- CreateTable: CorporateMembership — a member's pricing-only tie to a corporate account (join-code path).
CREATE TABLE "CorporateMembership" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "source" "CorporateMembershipSource" NOT NULL DEFAULT 'JOIN_CODE',
    "status" "CorporateMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "join_code_used" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "CorporateMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporateMembership_org_id_idx" ON "CorporateMembership"("org_id");

-- CreateIndex
CREATE INDEX "CorporateMembership_user_id_idx" ON "CorporateMembership"("user_id");

-- CreateIndex
CREATE INDEX "CorporateMembership_account_id_idx" ON "CorporateMembership"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateMembership_user_id_account_id_key" ON "CorporateMembership"("user_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "Account_join_code_key" ON "Account"("join_code");

-- CreateIndex
CREATE INDEX "Order_pricing_account_id_idx" ON "Order"("pricing_account_id");

-- AddForeignKey
ALTER TABLE "CorporateMembership" ADD CONSTRAINT "CorporateMembership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateMembership" ADD CONSTRAINT "CorporateMembership_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pricing_account_id_fkey" FOREIGN KEY ("pricing_account_id") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
