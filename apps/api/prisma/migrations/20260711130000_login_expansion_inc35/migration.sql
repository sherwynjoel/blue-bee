-- Increment 35 — Login expansion (email+password + Apple/Google). ADDITIVE only.
--   • Two nullable columns on "User": password_hash (bcrypt at rest, never plaintext) + email_verified_at
--     (the trust anchor for OAuth dedupe-by-verified-email).
--   • A single-use, expiring, HASHED token table "AuthToken" (email verification + password reset).
-- No data destroyed; every existing row keeps all its values (existing users simply have NULL for the new
-- columns — phone-OTP is unchanged).
--
-- NOTE: as with every migration since Inc-19, `migrate diff` also emits phantom DROP INDEX lines for the
-- raw NULLS-NOT-DISTINCT + PostGIS-GiST indexes Prisma's schema can't express — DELIBERATELY OMITTED here.

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "password_hash" TEXT,
                   ADD COLUMN "email_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_token_hash_key" ON "AuthToken"("token_hash");

-- CreateIndex
CREATE INDEX "AuthToken_org_id_idx" ON "AuthToken"("org_id");

-- CreateIndex
CREATE INDEX "AuthToken_user_id_purpose_idx" ON "AuthToken"("user_id", "purpose");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
