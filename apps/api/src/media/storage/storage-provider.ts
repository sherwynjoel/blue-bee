/**
 * The object-storage seam (Increment 10, PRD §10/§11.2 — S3 is an explicitly swappable provider).
 * The engine talks ONLY to this interface; the concrete impl (`S3StorageProvider`) speaks the AWS
 * SDK against real AWS S3 (prod) or MinIO (dev/test) — the same protocol path either way.
 */

/** Result of a HEAD on an object — used at confirm to verify a real upload before persisting a row. */
export interface ObjectHead {
  exists: boolean;
  contentType: string | null;
  size: number | null;
}

export interface StorageProvider {
  /** A short-lived presigned PUT URL (the client uploads bytes directly). Both the `contentType` AND
   *  the exact `byteSize` (Content-Length) are signed into the URL, so the upload must match both —
   *  bounding the object size at UPLOAD time (not just at confirm). */
  presignPut(key: string, contentType: string, byteSize: number, ttlSec: number): Promise<string>;
  /** A short-lived presigned GET URL (§14 signed, expiring reads). */
  presignGet(key: string, ttlSec: number): Promise<string>;
  /** HEAD an object: existence + server-reported content type + size. */
  head(key: string): Promise<ObjectHead>;
  /** Delete an object (orphan cleanup). */
  delete(key: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
