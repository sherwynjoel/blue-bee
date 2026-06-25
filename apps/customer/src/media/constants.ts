/**
 * Client-side mirror of the server media allow-list (apps/api/src/config/media.config.ts defaults)
 * so we reject a bad capture BEFORE presign — the presigned PUT signs Content-Type + Content-Length,
 * so a mismatch would be rejected at the edge anyway, but failing fast is a better UX. The presign
 * RESPONSE also returns the authoritative `maxBytes`, which we re-check before the PUT (defense in
 * depth, in case a deployment lowered the limit via env).
 */
export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** Default server max (MEDIA_MAX_BYTES) — 15 MiB. The real limit is the presign response's maxBytes. */
export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

export function isAllowedContentType(contentType: string): contentType is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

export interface MediaValidationError {
  code: 'unsupported_content_type' | 'too_large' | 'empty';
  message: string;
}

/** Validate a capture against the allow-list + a max (client-side match of the server contract). */
export function validateMedia(
  contentType: string,
  byteSize: number,
  maxBytes: number = DEFAULT_MAX_BYTES,
): MediaValidationError | null {
  if (!byteSize || byteSize <= 0) {
    return { code: 'empty', message: 'The selected file is empty.' };
  }
  if (!isAllowedContentType(contentType)) {
    return {
      code: 'unsupported_content_type',
      message: `Unsupported file type "${contentType}". Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}.`,
    };
  }
  if (byteSize > maxBytes) {
    return {
      code: 'too_large',
      message: `File is too large (${(byteSize / 1024 / 1024).toFixed(1)} MiB). Max ${(maxBytes / 1024 / 1024).toFixed(0)} MiB.`,
    };
  }
  return null;
}

/** Map a file uri/name to a content type when the picker doesn't supply a mime type. */
export function contentTypeForUri(uri: string, fallback = 'image/jpeg'): string {
  const ext = uri.split('?')[0]?.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    default:
      return fallback;
  }
}
