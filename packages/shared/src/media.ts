/**
 * Media / object-storage contract (Increment 10) — the real presigned upload → confirm → signed-read
 * flow (PRD §10/§11.2 S3, §14 signed expiring URLs). Replaces the Increment-3 interim where a photo
 * registered a *reference* to an already-hosted object. Two endpoints:
 *   POST /v1/media/presign  — authorize the target + return a short-lived presigned PUT URL + key
 *   POST /v1/media/confirm  — after the client PUTs bytes, HEAD-verify the object + create the Photo
 *
 * The driver POD (Increment 9 deferral) and the customer before/after photos (Increment 11) consume
 * this capability; this increment ships the capability + the intake retrofit.
 */
import { z } from 'zod';
import { PhotoKind } from './enums';
import { geoPointSchema } from './validators';

/**
 * Presign request. The target is an order (the authorization root) + optionally a specific item;
 * `kind` is the §9.3 photo kind; `contentType` + `byteSize` are validated against the configured
 * allow-list + max at presign and re-verified by a real HEAD at confirm.
 */
export const presignMediaSchema = z.object({
  orderId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
  kind: z.nativeEnum(PhotoKind),
  contentType: z.string().min(1).max(128),
  byteSize: z.number().int().positive(),
});
export type PresignMediaDto = z.infer<typeof presignMediaSchema>;

export interface PresignMediaResult {
  /** Short-lived presigned PUT URL — the client uploads bytes directly with `Content-Type: contentType`. */
  uploadUrl: string;
  /** The org-namespaced object key to pass back to /media/confirm. */
  storageKey: string;
  /** The content type the upload MUST use (signed into the URL). */
  contentType: string;
  expiresInSec: number;
  maxBytes: number;
}

/** Confirm a completed upload — the engine HEAD-verifies the object then creates the Photo row. */
export const confirmMediaSchema = z.object({
  storageKey: z.string().min(1).max(1024),
  /** Optional capture metadata (known after capture, not at presign). */
  geo: geoPointSchema.optional(),
  takenAt: z.string().datetime().optional(),
});
export type ConfirmMediaDto = z.infer<typeof confirmMediaSchema>;

/** A persisted media object (response shape). `downloadUrl` is a freshly-minted, short-lived signed
 *  GET URL (§14) — never a raw key or a public link. */
export interface MediaResult {
  id: string;
  kind: PhotoKind;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
  orderId: string | null;
  itemId: string | null;
  takenAt: string;
  createdAt: string;
}

/** Stable error codes for the media endpoints (problem+json `error`/`title`). */
export const MEDIA_ERRORS = {
  /** content type not in the configured allow-list. */
  UNSUPPORTED_CONTENT_TYPE: 'media.unsupported_content_type',
  /** declared/actual size exceeds the configured max. */
  TOO_LARGE: 'media.too_large',
  /** no presigned-upload intent for this key (you didn't presign it, or it's another org's). */
  UPLOAD_NOT_FOUND: 'media.upload_not_found',
  /** the object was never uploaded (HEAD found nothing). */
  OBJECT_NOT_FOUND: 'media.object_not_found',
  /** the uploaded object's content-type/size doesn't match what was presigned. */
  OBJECT_MISMATCH: 'media.object_mismatch',
} as const;
export type MediaErrorCode = (typeof MEDIA_ERRORS)[keyof typeof MEDIA_ERRORS];
