-- Increment 10 — presigned media / storage path (additive, reversible).
-- Photo objects now persist an org-namespaced object KEY (signed GET minted on read) instead of a
-- public URL; `url` becomes nullable (legacy external-reference fallback only). A MediaUpload intent
-- records each presign so confirm can prove "the caller presigned this key" + reconcile orphans.

-- CreateEnum
CREATE TYPE "MediaUploadStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterTable: Photo gains the storage key + content metadata; url becomes nullable.
ALTER TABLE "Photo"
  ADD COLUMN "storage_key"  TEXT,
  ADD COLUMN "content_type" TEXT,
  ADD COLUMN "size_bytes"   INTEGER;
ALTER TABLE "Photo" ALTER COLUMN "url" DROP NOT NULL;
CREATE UNIQUE INDEX "Photo_storage_key_key" ON "Photo"("storage_key");

-- AlterTable: ProofOfDelivery signature as a real object key (POD capture is a later increment).
ALTER TABLE "ProofOfDelivery" ADD COLUMN "signature_key" TEXT;

-- CreateTable: MediaUpload (the presigned-upload intent).
CREATE TABLE "MediaUpload" (
    "id"           UUID NOT NULL,
    "org_id"       UUID NOT NULL,
    "storage_key"  TEXT NOT NULL,
    "kind"         "PhotoKind" NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size"    INTEGER NOT NULL,
    "order_id"     UUID,
    "item_id"      UUID,
    "status"       "MediaUploadStatus" NOT NULL DEFAULT 'PENDING',
    "photo_id"     UUID,
    "created_by"   UUID NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MediaUpload_storage_key_key" ON "MediaUpload"("storage_key");
CREATE INDEX "MediaUpload_org_id_idx" ON "MediaUpload"("org_id");
CREATE INDEX "MediaUpload_status_idx" ON "MediaUpload"("status");
