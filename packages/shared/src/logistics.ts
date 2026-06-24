/**
 * Logistics contract (Increment 4) — Zod request schemas + DTO types for the
 * Route → Stop backbone (PRD §5.4, §6.3, §9.5, §11.1 DISPATCH/driver-stop rows).
 *
 * The §5.4 stop state machine itself lives in `lifecycle.ts`
 * (`canTransitionStop` / `ROUTE_STOP_TRANSITIONS`); these are the wire shapes for
 * fleet management, route building/assignment/publishing, sequencing, and the
 * driver-stop verbs. No live tracking here (that is Increment 5).
 */
import { z } from 'zod';
import { RouteStopKind, RouteStatus, RouteStopStatus, VehicleStatus } from './enums';
import { geoPointSchema, timeWindowSchema } from './validators';

// ───────────────────────────── fleet: vehicle / driver / shift ─────────────────────────────

export const createVehicleSchema = z.object({
  label: z.string().min(1).max(120),
  capacity: z.number().int().positive().optional(),
  plate: z.string().min(1).max(20).optional(),
});
export type CreateVehicleDto = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    capacity: z.number().int().positive().nullable().optional(),
    plate: z.string().min(1).max(20).nullable().optional(),
    status: z.nativeEnum(VehicleStatus).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });
export type UpdateVehicleDto = z.infer<typeof updateVehicleSchema>;

export const createDriverSchema = z.object({
  userId: z.string().uuid(),
  license: z.string().min(1).max(60).optional(),
  defaultVehicleId: z.string().uuid().optional(),
});
export type CreateDriverDto = z.infer<typeof createDriverSchema>;

export const createShiftSchema = z.object({
  driverId: z.string().uuid(),
  vehicleId: z.string().uuid(),
});
export type CreateShiftDto = z.infer<typeof createShiftSchema>;

export const shiftActionSchema = z.object({ note: z.string().max(500).optional() }).default({});
export type ShiftActionDto = z.infer<typeof shiftActionSchema>;

// ───────────────────────────── routes ─────────────────────────────

export const createRouteSchema = z.object({
  date: z.coerce.date(),
  driverId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  /** Depot/start point for the sequencer (PostGIS distance origin). */
  startGeo: geoPointSchema.optional(),
});
export type CreateRouteDto = z.infer<typeof createRouteSchema>;

export const assignRouteSchema = z
  .object({ driverId: z.string().uuid().nullable().optional(), vehicleId: z.string().uuid().nullable().optional() })
  .refine((d) => d.driverId !== undefined || d.vehicleId !== undefined, { message: 'provide driverId and/or vehicleId' });
export type AssignRouteDto = z.infer<typeof assignRouteSchema>;

export const publishRouteSchema = z.object({ note: z.string().max(500).optional() }).default({});
export type PublishRouteDto = z.infer<typeof publishRouteSchema>;

export const optimizeRouteSchema = z.object({ strategy: z.literal('nearest_neighbour').optional() }).default({});
export type OptimizeRouteDto = z.infer<typeof optimizeRouteSchema>;

// ───────────────────────────── route stops ─────────────────────────────

export const addStopSchema = z.object({
  orderId: z.string().uuid(),
  kind: z.nativeEnum(RouteStopKind).default(RouteStopKind.PICKUP),
  timeWindow: timeWindowSchema.optional(),
  /** Optional explicit sequence position; otherwise appended to the end. */
  seq: z.number().int().positive().optional(),
});
export type AddStopDto = z.infer<typeof addStopSchema>;

/** PATCH a stop: resequence within its route and/or move it to another route (reassign driver). */
export const patchStopSchema = z
  .object({
    seq: z.number().int().positive().optional(),
    routeId: z.string().uuid().optional(),
    timeWindow: timeWindowSchema.optional(),
  })
  .refine((d) => d.seq !== undefined || d.routeId !== undefined || d.timeWindow !== undefined, {
    message: 'provide seq, routeId, and/or timeWindow',
  });
export type PatchStopDto = z.infer<typeof patchStopSchema>;

/** depart / arrive / start / complete carry an optional note. */
export const stopActionSchema = z.object({ note: z.string().max(500).optional() }).default({});
export type StopActionDto = z.infer<typeof stopActionSchema>;

/** fail / skip REQUIRE a reason code (PRD §5.4/§6.3 exceptions). */
export const stopExceptionSchema = z.object({
  reason: z.string().min(2).max(200),
  note: z.string().max(500).optional(),
});
export type StopExceptionDto = z.infer<typeof stopExceptionSchema>;

// ───────────────────────────── list queries ─────────────────────────────

export const listRoutesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(RouteStatus).optional(),
});
export type ListRoutesQuery = z.infer<typeof listRoutesQuerySchema>;

export const listStopsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.nativeEnum(RouteStopStatus).optional(),
  routeId: z.string().uuid().optional(),
});
export type ListStopsQuery = z.infer<typeof listStopsQuerySchema>;

// ───────────────────────────── error codes (problem+json title) ─────────────────────────────

export const LOGISTICS_ERRORS = {
  ROUTE_NOT_FOUND: 'route_not_found',
  STOP_NOT_FOUND: 'stop_not_found',
  VEHICLE_NOT_FOUND: 'vehicle_not_found',
  DRIVER_NOT_FOUND: 'driver_not_found',
  SHIFT_NOT_FOUND: 'shift_not_found',
  ILLEGAL_STOP_TRANSITION: 'illegal_stop_transition',
  ILLEGAL_SHIFT_TRANSITION: 'illegal_shift_transition',
  REASON_REQUIRED: 'reason_required',
  ROUTE_NOT_DRAFT: 'route_not_draft',
  INVALID_ROUTE_STATE: 'invalid_route_state',
  STOP_ORDER_INVALID: 'stop_order_invalid',
  CROSS_ORG_FORBIDDEN: 'cross_org_forbidden',
  SEQ_TAKEN: 'seq_taken',
} as const;
export type LogisticsErrorCode = (typeof LOGISTICS_ERRORS)[keyof typeof LOGISTICS_ERRORS];
