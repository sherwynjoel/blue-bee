import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { GeofenceEventType, type LiveGeofenceEvent } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TRACKING_CONFIG, type TrackingConfig } from '../config/tracking.config';
import { RealtimePublisher } from '../realtime/realtime-publisher.service';
import type { ActiveStopEta } from './eta.service';

/**
 * The geofence types EMITTED on the wire this phase. `Partial` + the absence of `DEPARTED` is
 * deliberate — DEPARTED is modeled (§9.5) but not emitted, so `WIRE_TYPE[DEPARTED]` is `undefined`
 * and the emit is skipped. An exhaustive map (not a 2-way ternary) means a future emittable type
 * can never be silently mislabeled.
 */
const WIRE_TYPE: Partial<Record<GeofenceEventType, LiveGeofenceEvent['type']>> = {
  [GeofenceEventType.APPROACHING]: 'APPROACHING',
  [GeofenceEventType.ARRIVED]: 'ARRIVED',
};

/**
 * A geofence event that was NEWLY written this evaluation (one per stop per type). Returned to the
 * caller so the predictive layer can raise notifications off it (Increment 8) — carries the durable
 * row id (the notification dedup source) + the ETA/distance for the message templates.
 */
export interface FiredGeofence {
  geofenceEventId: string;
  type: GeofenceEventType;
  stopId: string;
  orderId: string | null;
  vehicleId: string;
  occurredAt: Date;
  etaSeconds: number;
  distanceMeters: number;
}

/**
 * Geofence evaluation (PRD §6.4 / §9.5) — runs right after the ETA recompute on a genuine advance,
 * reusing the ETA's already-computed distance + ETA (no extra PostGIS round-trip).
 *
 *  • `APPROACHING` fires when the vehicle is within `approachingRadiusM` OR the ETA ≤
 *    `approachingEtaSec` (the §6.4 "800 m / 5 min" rule — either, whichever first).
 *  • `ARRIVED` fires when within the tighter `arrivedRadiusM`.
 *
 * Each type fires EXACTLY ONCE per stop: the durable `GeofenceEvent` row is written with
 * `INSERT … ON CONFLICT (route_stop_id, type) DO NOTHING` (the Increment-5 idempotency pattern),
 * so a re-entry after GPS/traffic jitter, a replay, or a concurrent same-vehicle batch appends no
 * duplicate and emits nothing further. We emit on the realtime channels ONLY when a row was
 * actually inserted (count === 1).
 *
 * ADVISORY ONLY: an `ARRIVED` detection writes the event + emits — it does NOT transition the §5.4
 * stop. The driver stays authoritative (Increment 4).
 *
 * No notification delivery here (a later increment): the durable row + the realtime event ARE the
 * triggers the notifications increment will consume.
 */
@Injectable()
export class GeofenceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACKING_CONFIG) private readonly config: TrackingConfig,
    private readonly realtime: RealtimePublisher,
  ) {}

  async evaluate(orgId: string, vehicleId: string, ctx: ActiveStopEta): Promise<FiredGeofence[]> {
    const g = this.config.geofence;
    const toFire: GeofenceEventType[] = [];
    if (ctx.distanceMeters <= g.approachingRadiusM || ctx.etaSeconds <= g.approachingEtaSec) {
      toFire.push(GeofenceEventType.APPROACHING);
    }
    if (ctx.distanceMeters <= g.arrivedRadiusM) {
      toFire.push(GeofenceEventType.ARRIVED);
    }

    const fired: FiredGeofence[] = [];
    for (const type of toFire) {
      const occurredAt = new Date();
      const geofenceEventId = await this.insertOnce(orgId, ctx.stopId, type, occurredAt);
      if (!geofenceEventId) continue; // already fired for this stop+type — no re-fire, no emit (idempotent)

      // Map to the wire type EXPLICITLY (only APPROACHING/ARRIVED are emitted this phase; DEPARTED is
      // modeled but never pushed to `toFire`). An exhaustive map — not a 2-way ternary — so a future
      // emittable type can never be silently mislabeled as ARRIVED.
      const wireType = WIRE_TYPE[type];
      if (!wireType) continue;

      const payload: LiveGeofenceEvent = {
        vehicleId,
        stopId: ctx.stopId,
        orderId: ctx.orderId,
        type: wireType,
        occurredAt: occurredAt.toISOString(),
      };
      // Customer STOP room (stop-specific) + org fleet room — same scoping as the ETA emit.
      this.realtime.publishGeofence(orgId, ctx.stopId, payload);

      // Hand the newly-written event to the predictive layer to raise notifications (Increment 8).
      fired.push({
        geofenceEventId,
        type,
        stopId: ctx.stopId,
        orderId: ctx.orderId,
        vehicleId,
        occurredAt,
        etaSeconds: ctx.etaSeconds,
        distanceMeters: ctx.distanceMeters,
      });
    }
    return fired;
  }

  /**
   * Idempotent insert of one geofence event. Returns the new row id iff a NEW row was written;
   * null on conflict (the type already fired for this stop). `created_by` is NULL — a
   * system-detected event has no actor. Explicit `org_id`. The RETURNING id (present only on a real
   * insert, empty on conflict) doubles as the once-per-stop guard AND the notification dedup source.
   */
  private async insertOnce(orgId: string, stopId: string, type: GeofenceEventType, occurredAt: Date): Promise<string | null> {
    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "GeofenceEvent" ("id", "org_id", "route_stop_id", "type", "occurred_at", "created_at", "updated_at", "created_by")
      VALUES (${id}::uuid, ${orgId}::uuid, ${stopId}::uuid, ${type}::"GeofenceEventType", ${occurredAt}, now(), now(), NULL)
      ON CONFLICT ("route_stop_id", "type") DO NOTHING
      RETURNING id::text AS "id"
    `);
    return rows[0]?.id ?? null;
  }
}
