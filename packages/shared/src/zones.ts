/**
 * Geo-blocking contracts (Increment 19) — owner-drawn service zones + out-of-area demand capture. Single
 * source of truth for the wire shapes shared by the API, the web console (zone editor), and the customer
 * app. A booking whose service point falls in NO active zone is blocked (422 `zone.out_of_service_area`)
 * and captured as a CoverageRequest — the server is authoritative (the app never decides serviceability).
 *
 * The zone polygon is a GeoJSON Polygon (single exterior ring, no holes this increment). Validation here is
 * SHAPE ONLY (closed ring, sane vertex count/bounds); PostGIS `ST_IsValid` is the FINAL geometry gate
 * server-side (it rejects self-intersecting/degenerate rings a shape check can't catch).
 */
import { z } from 'zod';

// ─────────────────────────── geometry (GeoJSON polygon) ───────────────────────────

/** A single WGS84 position `[lng, lat]` (GeoJSON axis order — longitude first). */
export const geoPositionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export type GeoPosition = z.infer<typeof geoPositionSchema>;

/** Guard against absurd payloads (a drawn zone is tens of vertices, not tens of thousands). */
export const MAX_RING_VERTICES = 10_000;

/**
 * A GeoJSON Polygon with exactly ONE exterior ring (no holes this increment — a service zone is a simple
 * area; disjoint coverage = separate zone rows). A valid ring is closed (first position == last) and has
 * ≥ 4 positions (≥ 3 distinct vertices + the closing repeat).
 */
export const geoPolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(geoPositionSchema).min(4).max(MAX_RING_VERTICES)).length(1),
  })
  .superRefine((poly, ctx) => {
    const ring = poly.coordinates[0];
    if (!ring || ring.length < 4) return; // `.length(1)` + `.min(4)` already enforce this; guard for the type-checker
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'polygon ring must be closed (first position must equal last)' });
    }
    // Distinct vertices (excluding the closing repeat) must be ≥ 3 to enclose a real area.
    const distinct = new Set(ring.slice(0, -1).map((p) => `${p[0]},${p[1]}`));
    if (distinct.size < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'polygon must have at least 3 distinct vertices' });
    }
  });
export type GeoPolygon = z.infer<typeof geoPolygonSchema>;

// ─────────────────────────── service zones (owner-drawn) ───────────────────────────

export const createServiceZoneSchema = z.object({
  name: z.string().min(1).max(120),
  polygon: geoPolygonSchema,
  /** Defaults to `true` server-side when omitted. */
  active: z.boolean().optional(),
  /** Editor ordering; defaults to 0 server-side. */
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});
export type CreateServiceZoneDto = z.infer<typeof createServiceZoneSchema>;

/** Patch: rename / redraw (new polygon) / activate-deactivate / reorder. At least one field required. */
export const updateServiceZoneSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    polygon: geoPolygonSchema.optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'at least one field must be provided' });
export type UpdateServiceZoneDto = z.infer<typeof updateServiceZoneSchema>;

export interface ServiceZoneView {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  /** The drawn area as GeoJSON (round-trips to PostGIS geography and back via ST_AsGeoJSON). */
  polygon: GeoPolygon;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceZonesResult {
  zones: ServiceZoneView[];
}

// ─────────────────────────── coverage requests (out-of-area demand) ───────────────────────────

export const listCoverageRequestsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCoverageRequestsQuery = z.infer<typeof listCoverageRequestsQuerySchema>;

export interface CoverageRequestView {
  id: string;
  userId: string;
  address: string | null;
  /** The attempted service point (WGS84). */
  lng: number;
  lat: number;
  /** Optional booking-attempt context (e.g. { accountId, siteId }). */
  context: Record<string, unknown> | null;
  createdAt: string;
}

export interface CoverageRequestsResult {
  coverageRequests: CoverageRequestView[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const ZONE_ERRORS = {
  /** 422 — the booking's service point is outside every active service zone (demand captured). */
  OUT_OF_SERVICE_AREA: 'zone.out_of_service_area',
  ZONE_NOT_FOUND: 'zone.zone_not_found',
  INVALID_POLYGON: 'zone.invalid_polygon',
} as const;
export type ZoneErrorCode = (typeof ZONE_ERRORS)[keyof typeof ZONE_ERRORS];
