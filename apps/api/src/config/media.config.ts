/**
 * Media / object-storage config (Increment 10). Drives the StorageProvider (AWS S3 in prod, MinIO
 * locally) + the presign/confirm/signed-read flow. Everything env-driven — no literals in code.
 *
 * Provider selection: when `S3_ENDPOINT` is set (MinIO/dev) the SDK targets that endpoint with
 * path-style addressing; otherwise it targets real AWS S3 in `AWS_REGION`. The SAME AWS SDK code
 * path runs against both, so MinIO fully proves the S3 protocol path.
 *
 * Encryption at rest (PRD §14): the production bucket carries S3 **default encryption** (SSE-S3/KMS,
 * an IaC/bucket-policy concern — the standard way), so the presigned PUT stays a clean single-header
 * upload. `MEDIA_SSE` optionally signs an explicit `x-amz-server-side-encryption` into the PUT when a
 * deployment prefers per-request SSE (the client must then echo that header); default off.
 */
export interface MediaConfig {
  region: string;
  bucket: string;
  /** S3-compatible endpoint (MinIO). null ⇒ real AWS S3. */
  endpoint: string | null;
  forcePathStyle: boolean;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  /** TTL (seconds) for the presigned PUT (upload) URL. */
  presignPutTtlSec: number;
  /** TTL (seconds) for the presigned GET (download) URL. */
  presignGetTtlSec: number;
  /** Hard upper bound on an uploaded object's size, enforced at presign (declared) + confirm (head). */
  maxBytes: number;
  /** Allow-listed upload content types. */
  allowedContentTypes: string[];
  /** Create the bucket on startup if missing (dev/MinIO only; prod buckets are pre-provisioned). */
  ensureBucket: boolean;
  /** Optional explicit per-request SSE header to sign into the PUT (e.g. 'AES256'); null ⇒ rely on
   *  the bucket's default encryption. */
  sse: string | null;
  /**
   * Legacy external-reference allow-list (Increment-3 interim). Retained ONLY as a documented
   * fallback for referencing an already-hosted object; newly-captured media goes through the real
   * presigned upload. Empty ⇒ external references disabled.
   */
  legacyAllowedOrigins: string[];
}

export const MEDIA_CONFIG = Symbol('MEDIA_CONFIG');

function str(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key]?.trim();
  return v && v.length > 0 ? v : fallback;
}
function strOrNull(env: NodeJS.ProcessEnv, key: string): string | null {
  const v = env[key]?.trim();
  return v && v.length > 0 ? v : null;
}
function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const v = env[key]?.trim().toLowerCase();
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}
function intPositive(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function csv(env: NodeJS.ProcessEnv, key: string, fallback: string[]): string[] {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

const DEFAULT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function loadMediaConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const endpoint = strOrNull(env, 'S3_ENDPOINT');
  return {
    region: str(env, 'AWS_REGION', 'ca-central-1'),
    bucket: str(env, 'S3_BUCKET', 'bluebee-media'),
    endpoint,
    // path-style is required for MinIO; default true whenever a custom endpoint is set.
    forcePathStyle: bool(env, 'S3_FORCE_PATH_STYLE', endpoint != null),
    accessKeyId: strOrNull(env, 'AWS_ACCESS_KEY_ID'),
    secretAccessKey: strOrNull(env, 'AWS_SECRET_ACCESS_KEY'),
    presignPutTtlSec: intPositive(env, 'MEDIA_PRESIGN_PUT_TTL_SEC', 300),
    presignGetTtlSec: intPositive(env, 'MEDIA_PRESIGN_GET_TTL_SEC', 300),
    maxBytes: intPositive(env, 'MEDIA_MAX_BYTES', 15 * 1024 * 1024),
    allowedContentTypes: csv(env, 'MEDIA_ALLOWED_CONTENT_TYPES', DEFAULT_CONTENT_TYPES),
    // create the bucket on boot only for a custom endpoint (MinIO/dev); never assume create perms on prod S3.
    ensureBucket: bool(env, 'MEDIA_ENSURE_BUCKET', endpoint != null),
    sse: strOrNull(env, 'MEDIA_SSE'),
    legacyAllowedOrigins: (env.MEDIA_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
