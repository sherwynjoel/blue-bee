-- Increment 34 — Referral (invite + code + attribution). Reward DEFERRED (no reward table/logic here).
-- ADDITIVE: two nullable columns on "User" (referral_code, referred_by_user_id) + a unique index + a
-- self-FK + a supporting index, then a collision-safe BACKFILL of referral_code for existing residential
-- customers. No data destroyed; every existing row keeps all its values.
--
-- NOTE: as with every migration since Inc-19, `migrate diff` also emits phantom DROP INDEX lines for the
-- raw NULLS-NOT-DISTINCT + PostGIS-GiST indexes Prisma's schema can't express — DELIBERATELY OMITTED here.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "referral_code" TEXT,
                   ADD COLUMN "referred_by_user_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "User_referral_code_key" ON "User"("referral_code");

-- CreateIndex
CREATE INDEX "User_referred_by_user_id_idx" ON "User"("referred_by_user_id");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referred_by_user_id_fkey" FOREIGN KEY ("referred_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: give every existing RESIDENTIAL_CUSTOMER a unique, unambiguous referral code. The alphabet
-- excludes 0/O/1/I/L and the length is 8 — these MUST match packages/shared/src/referral.ts (the single
-- source of truth used at runtime). Collision-safe: the inner loop regenerates until the candidate is
-- unused, and the UNIQUE index is the backstop. Idempotent — only rows still lacking a code are touched.
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  i INT;
BEGIN
  FOR r IN
    SELECT DISTINCT u.id
    FROM "User" u
    JOIN "UserRole" ur ON ur.user_id = u.id AND ur.role = 'RESIDENTIAL_CUSTOMER'
    WHERE u.referral_code IS NULL
  LOOP
    LOOP
      candidate := '';
      FOR i IN 1..8 LOOP
        candidate := candidate || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "User" WHERE referral_code = candidate);
    END LOOP;
    UPDATE "User" SET referral_code = candidate WHERE id = r.id;
  END LOOP;
END $$;
