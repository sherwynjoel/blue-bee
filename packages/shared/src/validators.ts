/**
 * Zod validators + the DTO shapes derived from them. The API imports these
 * directly (e.g. the health endpoint validates its own payload, the exception
 * filter builds RFC 7807 problem+json), so `@blue-bee/shared` is genuinely
 * consumed — there are no placeholder exports here.
 */
import { z } from 'zod';
import {
  AccountType,
  CommsChannel,
  CustodyStage,
  OrderStatus,
  OrderType,
  OrderVertical,
  PhotoKind,
  QuoteStatus,
  RoleScope,
  RoleType,
  RouteStopStatus,
  ServiceUnit,
  ServiceVertical,
  TagBinding,
  TagType,
} from './enums';

// ───────────────────────────── enum validators ─────────────────────────────
export const accountTypeSchema = z.nativeEnum(AccountType);
export const roleTypeSchema = z.nativeEnum(RoleType);
export const roleScopeSchema = z.nativeEnum(RoleScope);
export const serviceVerticalSchema = z.nativeEnum(ServiceVertical);
export const serviceUnitSchema = z.nativeEnum(ServiceUnit);
export const orderVerticalSchema = z.nativeEnum(OrderVertical);
export const orderTypeSchema = z.nativeEnum(OrderType);
export const orderStatusSchema = z.nativeEnum(OrderStatus);
export const quoteStatusSchema = z.nativeEnum(QuoteStatus);
export const tagTypeSchema = z.nativeEnum(TagType);
export const tagBindingSchema = z.nativeEnum(TagBinding);
export const photoKindSchema = z.nativeEnum(PhotoKind);
export const custodyStageSchema = z.nativeEnum(CustodyStage);
export const routeStopStatusSchema = z.nativeEnum(RouteStopStatus);
export const commsChannelSchema = z.nativeEnum(CommsChannel);

// ─────────────────────────── shared primitives ─────────────────────────────

/** A WGS84 lng/lat pair (stored as PostGIS geography(Point,4326) server-side). */
export const geoPointSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

/** A scheduling window (pickup/delivery). */
export const timeWindowSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
});
export type TimeWindow = z.infer<typeof timeWindowSchema>;

// ───────────────────── RFC 7807 problem+json (PRD §11.1) ────────────────────
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.string()).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

// ─────────────────────── health endpoint contract (§12.3) ───────────────────
export const componentHealthSchema = z.object({
  name: z.string(),
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative().optional(),
  detail: z.string().optional(),
  error: z.string().optional(),
});
export type ComponentHealth = z.infer<typeof componentHealthSchema>;

export const healthStatusSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.string(),
  timestamp: z.string().datetime(),
  checks: z.array(componentHealthSchema),
});
export type HealthStatus = z.infer<typeof healthStatusSchema>;
