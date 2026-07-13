-- Increment 37 — Customer credit ledger (REAL money) + founder-authored Home content. ADDITIVE only.
--
--   • "CreditEntry" — an APPEND-ONLY, signed ledger. Balance = SUM(amount); there is deliberately NO stored
--     balance column to drift out of sync. Positive = granted, negative = spent. A correction is a NEW entry
--     (REVERSAL / ADJUSTMENT), never an UPDATE.
--     Double-grant / double-spend are prevented by the DATABASE, not by application luck:
--       - one REFERRAL_EARN per referred user  → UNIQUE (org_id, kind, referred_user_id)
--       - one REDEMPTION per order             → UNIQUE (org_id, kind, order_id)
--     (Postgres treats NULLs as distinct in a UNIQUE index, so these constraints only bind the rows that
--      actually carry the id — other kinds are unconstrained, which is exactly what we want.)
--
--   • "HomeBlock" — founder-authored "What's new" cards for the customer Home screen, edited in the console.
--
-- No existing row or column is touched.
--
-- NOTE: as with every migration since Inc-19, `migrate diff` also emits phantom DROP INDEX lines for the
-- raw NULLS-NOT-DISTINCT + PostGIS-GiST indexes Prisma's schema can't express — DELIBERATELY OMITTED here.

-- CreateEnum
CREATE TYPE "CreditEntryKind" AS ENUM ('REFERRAL_EARN', 'REDEMPTION', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "HomeBlockKind" AS ENUM ('ANNOUNCEMENT');

-- CreateTable
CREATE TABLE "CreditEntry" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "CreditEntryKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "order_id" UUID,
    "referred_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "CreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeBlock" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" "HomeBlockKind" NOT NULL DEFAULT 'ANNOUNCEMENT',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta_label" TEXT,
    "cta_target" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "HomeBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (the anti-double-grant / anti-double-spend guarantees)
CREATE UNIQUE INDEX "CreditEntry_org_id_kind_referred_user_id_key" ON "CreditEntry"("org_id", "kind", "referred_user_id");
CREATE UNIQUE INDEX "CreditEntry_org_id_kind_order_id_key" ON "CreditEntry"("org_id", "kind", "order_id");
CREATE INDEX "CreditEntry_org_id_idx" ON "CreditEntry"("org_id");
CREATE INDEX "CreditEntry_user_id_idx" ON "CreditEntry"("user_id");
CREATE INDEX "HomeBlock_org_id_idx" ON "HomeBlock"("org_id");

-- AddForeignKey
ALTER TABLE "CreditEntry" ADD CONSTRAINT "CreditEntry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditEntry" ADD CONSTRAINT "CreditEntry_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditEntry" ADD CONSTRAINT "CreditEntry_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- [Inc-37] A distinct settlement method for an order paid entirely from credit (no card charged), so finance
-- reporting never counts a credit-settled order as card revenue. Additive enum value; nothing uses it yet in
-- this migration, so it is safe inside the migration transaction.
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT';
