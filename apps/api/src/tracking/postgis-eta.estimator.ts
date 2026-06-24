import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TRACKING_CONFIG, type TrackingConfig } from '../config/tracking.config';
import { computeEta, deriveSpeedKmh, resolveSpeedKmh, type GeoPoint } from './eta-math';
import type { EtaContext, EtaEstimator, EtaResult } from './eta-estimator';

/**
 * The in-house ETA estimator (PRD §6.2), bound to the `ETA_ESTIMATOR` seam. The vehicle→stop
 * "remaining distance" is the SAME PostGIS `ST_Distance` on `geography(Point,4326)` the route
 * sequencer uses (geodesic, accurate) — NO external maps/routing API, NO maps key, no
 * hand-rolled distance for the destination leg. Speed is derived from the recent track and the
 * ETA is circuity-adjusted, EWMA-smoothed, capped, and surfaced as a range — all pure math in
 * `eta-math.ts`. The only async work is the single distance round-trip.
 */
@Injectable()
export class PostgisEtaEstimator implements EtaEstimator {
  readonly name = 'in_house_postgis_geodesic';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACKING_CONFIG) private readonly config: TrackingConfig,
  ) {}

  async estimate(from: GeoPoint, to: GeoPoint, ctx: EtaContext): Promise<EtaResult> {
    const eta = this.config.eta;
    const distanceMeters = await this.distanceMeters(from, to);
    const raw = deriveSpeedKmh(ctx.recentPings, eta.minMovementMeters);
    const { speedKmh, method } = resolveSpeedKmh(raw, eta);
    const math = computeEta({
      distanceMeters,
      speedKmh,
      cfg: eta,
      prevTargetMs: ctx.prevTargetMs,
      computeNowMs: ctx.computeNowMs,
    });
    return { ...math, distanceMeters, speedKmh, method };
  }

  /**
   * Geodesic distance (m) between two WGS84 points via PostGIS geography — the route sequencer's
   * exact `ST_Distance` pattern. Parameterised (no string interpolation of coordinates).
   */
  private async distanceMeters(from: GeoPoint, to: GeoPoint): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ dist: number }[]>(Prisma.sql`
      SELECT ST_Distance(
        ST_SetSRID(ST_MakePoint(${from.lng}, ${from.lat}), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${to.lng}, ${to.lat}), 4326)::geography
      )::float8 AS dist
    `);
    return rows[0]?.dist ?? Number.POSITIVE_INFINITY;
  }
}
