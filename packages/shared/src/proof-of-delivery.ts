/**
 * Driver proof-of-delivery (POD) contract — the last Phase-1 delivery-evidence gap (PRD §5.4 delivery,
 * §11.2/§14 media). At a DELIVERY stop the driver captures a delivery PHOTO + a SIGNATURE (both real
 * uploaded objects via the Increment-10 media path) + the device GEO, written to the existing 1:1
 * `ProofOfDelivery` row (unique on `routeStopId`). Authorization is DRIVER-self-scoped: a driver may
 * only capture POD for a stop on THEIR OWN route (`route.driverId`), so the customer `/v1/media` path
 * (order-ownership authorized) is never touched. Money/geo discipline mirrors the rest of the API.
 */
import { z } from 'zod';
import { geoPointSchema, type GeoPoint } from './validators';

/**
 * Presign a POD media upload for a stop the driver owns (the stop is the path param; the order is
 * resolved from the stop server-side — never trusted from the client). `contentType` + `byteSize`
 * are validated against the same media allow-list + max as the customer path and signed into the PUT.
 */
export const presignPodMediaSchema = z.object({
  contentType: z.string().min(1).max(128),
  byteSize: z.number().int().positive(),
});
export type PresignPodMediaDto = z.infer<typeof presignPodMediaSchema>;

/**
 * Capture the POD: a confirmed signature object key + at least one confirmed delivery-photo key (both
 * presigned + uploaded against THIS stop), plus the optional device geo. The server HEAD-verifies each
 * key (no raw-URL trust), links the photos to the POD, and stores the signature key. Idempotent on the
 * stop's unique POD row — re-submitting the same payload is safe.
 */
export const captureProofOfDeliverySchema = z.object({
  signatureStorageKey: z.string().min(1).max(1024),
  photoStorageKeys: z.array(z.string().min(1).max(1024)).min(1).max(10),
  geo: geoPointSchema.optional(),
});
export type CaptureProofOfDeliveryDto = z.infer<typeof captureProofOfDeliverySchema>;

/** A POD media object in the view — `downloadUrl` is a freshly-minted short-lived signed GET (§14). */
export interface PodMediaView {
  id: string;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
}

/** The captured proof of delivery (signed reads; never a raw key or public URL). */
export interface ProofOfDeliveryView {
  id: string;
  routeStopId: string;
  capturedAt: string;
  capturedBy: string | null;
  geo: GeoPoint | null;
  signature: PodMediaView | null;
  photos: PodMediaView[];
}

/** Stable error codes for the POD endpoints (problem+json `error`/`title`). */
export const POD_ERRORS = {
  /** A DELIVERY/BOTH stop cannot COMPLETE until a POD has been captured. */
  POD_REQUIRED: 'pod.pod_required',
  /** POD only applies to DELIVERY/BOTH stops (a PICKUP stop has no delivery to prove). */
  STOP_NOT_DELIVERY: 'pod.stop_not_delivery',
  /** The stop has no order attached — nothing to attribute the POD media to. */
  STOP_HAS_NO_ORDER: 'pod.stop_has_no_order',
  /** A referenced storage key is not a confirmed POD object presigned for this stop. */
  MEDIA_NOT_CONFIRMED: 'pod.media_not_confirmed',
} as const;
export type PodErrorCode = (typeof POD_ERRORS)[keyof typeof POD_ERRORS];
