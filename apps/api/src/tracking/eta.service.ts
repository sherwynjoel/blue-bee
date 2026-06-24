import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StopEta } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TRACKING_CONFIG, type TrackingConfig } from '../config/tracking.config';
import { RealtimePublisher } from '../realtime/realtime-publisher.service';
import { ETA_ESTIMATOR, type EtaEstimator } from './eta-estimator';
import type { GeoPoint, TrackPoint } from './eta-math';

/** One row of the active-stop resolution (the stop the vehicle is currently heading to / at). */
interface ActiveStopRow {
  stopId: string;
  orderId: string | null;
  /** Prior persisted ETA target (EWMA memory) — null until first computed. */
  eta: Date | null;
  etaComputedAt: Date | null;
  destLat: number;
  destLng: number;
}

/** What `recomputeForVehicle` hands the geofence eval — distance + ETA are already computed, so
 *  geofence reuses them with NO extra PostGIS round-trip. */
export interface ActiveStopEta {
  stopId: string;
  orderId: string | null;
  distanceMeters: number;
  etaSeconds: number;
}

/**
 * Server-side ETA recompute (PRD §6.2) — runs on a genuine last-known advance (a "ping cluster",
 * §10.4). Resolves the vehicle's CURRENT active stop (a workable route + a stop that is EN_ROUTE
 * or ARRIVED — never PENDING/terminal, §6.2), reads the stop's geo destination (its Site point)
 * and the recent track, asks the in-house estimator for a smoothed ETA range, PERSISTS it on the
 * stop (so REST reads + the console see it), and emits it on the realtime channels. Returns the
 * distance + ETA for the geofence eval, or null when there's nothing to compute.
 *
 * Tenancy: this runs off an internal advance-hook with no request principal, so every query +
 * write carries an EXPLICIT `org_id` (the Increment-4 lesson — the scoped Prisma extension does
 * not apply here).
 */
@Injectable()
export class EtaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACKING_CONFIG) private readonly config: TrackingConfig,
    @Inject(ETA_ESTIMATOR) private readonly estimator: EtaEstimator,
    private readonly realtime: RealtimePublisher,
  ) {}

  async recomputeForVehicle(orgId: string, vehicleId: string, position: GeoPoint): Promise<ActiveStopEta | null> {
    const nowMs = Date.now();
    const active = await this.resolveActiveStop(orgId, vehicleId);
    if (!active) return null; // no EN_ROUTE/ARRIVED stop with a geo destination — nothing to predict

    // Optional extra throttle on top of CAS-advance gating (default off): skip a recompute that
    // would land within `recomputeMinIntervalSec` of the previous one.
    const minInterval = this.config.eta.recomputeMinIntervalSec;
    if (minInterval > 0 && active.etaComputedAt && nowMs - active.etaComputedAt.getTime() < minInterval * 1000) {
      return null;
    }

    const recentPings = await this.recentTrack(orgId, vehicleId);
    const result = await this.estimator.estimate(
      position,
      { lat: active.destLat, lng: active.destLng },
      { recentPings, prevTargetMs: active.eta ? active.eta.getTime() : null, computeNowMs: nowMs },
    );

    const etaTargetMs = nowMs + result.etaSeconds * 1000;
    const lowTargetMs = nowMs + result.lowSeconds * 1000;
    const highTargetMs = nowMs + result.highSeconds * 1000;

    // Persist the latest snapshot on the stop (explicit org scope; no tx needed — single row).
    await this.prisma.routeStop.updateMany({
      where: { id: active.stopId, orgId },
      data: {
        eta: new Date(etaTargetMs),
        etaLow: new Date(lowTargetMs),
        etaHigh: new Date(highTargetMs),
        etaComputedAt: new Date(nowMs),
      },
    });

    const snapshot: StopEta = {
      stopId: active.stopId,
      eta: new Date(etaTargetMs).toISOString(),
      low: new Date(lowTargetMs).toISOString(),
      high: new Date(highTargetMs).toISOString(),
      etaSeconds: Math.round(result.etaSeconds),
      computedAt: new Date(nowMs).toISOString(),
    };
    // Emit to the customer's STOP room (stop-specific — a co-routed customer on a different stop
    // never sees this stop's ETA) + the org fleet room.
    this.realtime.publishEta(orgId, active.stopId, { ...snapshot, vehicleId, orderId: active.orderId });

    return { stopId: active.stopId, orderId: active.orderId, distanceMeters: result.distanceMeters, etaSeconds: result.etaSeconds };
  }

  /**
   * The vehicle's current active stop: a workable route (PUBLISHED/IN_PROGRESS) + a stop that is
   * EN_ROUTE or ARRIVED, ordered most-progressed first (ARRIVED before EN_ROUTE, then by seq),
   * with a geo-bearing site. Explicit `org_id` + `vehicle_id` — no cross-tenant read.
   */
  private async resolveActiveStop(orgId: string, vehicleId: string): Promise<ActiveStopRow | null> {
    const rows = await this.prisma.$queryRaw<
      { stopId: string; orderId: string | null; eta: Date | null; etaComputedAt: Date | null; destLat: number; destLng: number }[]
    >(Prisma.sql`
      SELECT rs.id::text AS "stopId",
             rs.order_id::text AS "orderId",
             rs.eta AS "eta",
             rs.eta_computed_at AS "etaComputedAt",
             ST_Y(s.geo::geometry)::float8 AS "destLat",
             ST_X(s.geo::geometry)::float8 AS "destLng"
      FROM "RouteStop" rs
      JOIN "Route" r ON r.id = rs.route_id
      JOIN "Site" s ON s.id = rs.site_id
      WHERE r.org_id = ${orgId}::uuid
        AND r.vehicle_id = ${vehicleId}::uuid
        AND r.status IN ('PUBLISHED', 'IN_PROGRESS')
        AND rs.status IN ('EN_ROUTE', 'ARRIVED')
        AND s.geo IS NOT NULL
      ORDER BY CASE rs.status WHEN 'ARRIVED' THEN 1 WHEN 'EN_ROUTE' THEN 2 ELSE 3 END, rs.seq ASC
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /** The last N pings for the vehicle (newest first) — the basis for the derived ground speed. */
  private async recentTrack(orgId: string, vehicleId: string): Promise<TrackPoint[]> {
    const rows = await this.prisma.$queryRaw<{ lat: number; lng: number; recordedAt: Date }[]>(Prisma.sql`
      SELECT ST_Y(geo::geometry)::float8 AS "lat",
             ST_X(geo::geometry)::float8 AS "lng",
             recorded_at AS "recordedAt"
      FROM "GpsPing"
      WHERE org_id = ${orgId}::uuid AND vehicle_id = ${vehicleId}::uuid AND geo IS NOT NULL
      ORDER BY recorded_at DESC
      LIMIT ${this.config.eta.recentPingSampleSize}
    `);
    return rows.map((r) => ({ lat: r.lat, lng: r.lng, recordedAtMs: r.recordedAt.getTime() }));
  }
}
