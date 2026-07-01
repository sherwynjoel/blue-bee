import type { MediaResult, PhotoKind } from '@blue-bee/shared';
import type { ConsoleApiClient } from './api-client';

/** Client-side allow-list (mirrors the server's; the server re-validates + HEAD-verifies). */
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export class MediaError extends Error {}

/**
 * Upload a real file through the Inc-10 media path from a web file input (Increment 13):
 * presign → PUT the REAL bytes (signed Content-Type) → confirm → signed read. The server authorizes
 * ownership (OrderAccessService), re-validates the allow-list/size, and HEAD-verifies the object.
 */
export async function uploadPhoto(
  client: ConsoleApiClient,
  args: { orderId: string; itemId?: string; kind: PhotoKind; file: File },
): Promise<MediaResult> {
  const { orderId, itemId, kind, file } = args;
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new MediaError(`Unsupported file type "${file.type || 'unknown'}". Use JPEG, PNG, WebP, or PDF.`);
  }
  const presign = await client.presignMedia({ orderId, itemId, kind, contentType: file.type, byteSize: file.size });
  // Defense in depth: re-check against the server's authoritative max before the PUT.
  if (file.size > presign.maxBytes) {
    throw new MediaError(`File is too large (${Math.round(file.size / 1024)} KB; max ${Math.round(presign.maxBytes / 1024)} KB).`);
  }
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': presign.contentType }, body: file });
  if (!put.ok) throw new MediaError(`Upload failed (HTTP ${put.status}).`);
  return client.confirmMedia({ storageKey: presign.storageKey, takenAt: new Date().toISOString() });
}

/**
 * [Inc-17] Upload a dry-clean catalog item photo (org-scoped, not order-tied): presign → PUT the REAL
 * bytes → return the storageKey (the item create/update verifies + stores it server-side). Reuses the
 * exact media seam, just the catalog presign endpoint. Images only (JPEG/PNG/WebP).
 */
export async function uploadCatalogImage(client: ConsoleApiClient, file: File): Promise<string> {
  const IMG = ['image/jpeg', 'image/png', 'image/webp'];
  if (!IMG.includes(file.type)) {
    throw new MediaError(`Unsupported image type "${file.type || 'unknown'}". Use JPEG, PNG, or WebP.`);
  }
  const presign = await client.presignCatalogImage({ contentType: file.type, byteSize: file.size });
  if (file.size > presign.maxBytes) {
    throw new MediaError(`Image is too large (${Math.round(file.size / 1024)} KB; max ${Math.round(presign.maxBytes / 1024)} KB).`);
  }
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': presign.contentType }, body: file });
  if (!put.ok) throw new MediaError(`Upload failed (HTTP ${put.status}).`);
  return presign.storageKey;
}
