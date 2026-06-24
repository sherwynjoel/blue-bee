import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NearestNeighbourOptimizer, type OptimizerStop, type RouteOptimizer } from './optimizer';

interface StopRow {
  id: string;
  seq: number;
  timeWindow: unknown;
}

/**
 * Resolves real PostGIS distances for a route's stops (geography distance from each
 * stop's site, plus the route's depot/start point) and feeds them to the pure
 * `RouteOptimizer`. The distance matrix is computed by Postgres/PostGIS (`ST_Distance`
 * on geography(Point,4326)) — no hand-rolled haversine, no external map API.
 */
@Injectable()
export class OptimizerService {
  private readonly engine: RouteOptimizer = new NearestNeighbourOptimizer();

  constructor(private readonly prisma: PrismaService) {}

  get engineName(): string {
    return this.engine.name;
  }

  /** Compute the optimal visit order for a route's stops. Returns ordered stop ids. */
  async sequence(routeId: string, orgId: string): Promise<string[]> {
    const stops = await this.prisma.routeStop.findMany({
      where: { routeId, orgId },
      orderBy: { seq: 'asc' },
      select: { id: true, seq: true, timeWindow: true },
    });
    if (stops.length <= 1) return stops.map((s) => s.id);

    // Stop-to-stop geography distances (only stops whose site has a geo point).
    const stopPairs = await this.prisma.$queryRaw<{ from_id: string; to_id: string; dist: number }[]>(Prisma.sql`
      WITH pts AS (
        SELECT rs.id, s.geo
        FROM "RouteStop" rs
        JOIN "Site" s ON s.id = rs.site_id
        WHERE rs.route_id = ${routeId}::uuid AND s.geo IS NOT NULL
      )
      SELECT a.id::text AS from_id, b.id::text AS to_id, ST_Distance(a.geo, b.geo)::float8 AS dist
      FROM pts a CROSS JOIN pts b
    `);

    // Depot-to-stop distances (only if the route has a start point).
    const depotPairs = await this.prisma.$queryRaw<{ to_id: string; dist: number }[]>(Prisma.sql`
      SELECT rs.id::text AS to_id, ST_Distance(r.start_geo, s.geo)::float8 AS dist
      FROM "RouteStop" rs
      JOIN "Site" s ON s.id = rs.site_id
      JOIN "Route" r ON r.id = rs.route_id
      WHERE rs.route_id = ${routeId}::uuid AND r.start_geo IS NOT NULL AND s.geo IS NOT NULL
    `);

    // Build the lookup matrix and the set of coordinate-bearing stops.
    const matrix = new Map<string, Map<string, number>>();
    const coordIds = new Set<string>();
    for (const row of stopPairs) {
      coordIds.add(row.from_id);
      coordIds.add(row.to_id);
      if (!matrix.has(row.from_id)) matrix.set(row.from_id, new Map());
      matrix.get(row.from_id)!.set(row.to_id, row.dist);
    }
    const hasDepot = depotPairs.length > 0;
    if (hasDepot) {
      const depot = new Map<string, number>();
      for (const row of depotPairs) depot.set(row.to_id, row.dist);
      matrix.set('DEPOT', depot);
    }

    const distance = (fromId: string, toId: string): number => matrix.get(fromId)?.get(toId) ?? Number.POSITIVE_INFINITY;

    const optimizerStops: OptimizerStop[] = stops.map((s: StopRow, index) => ({
      id: s.id,
      hasCoord: coordIds.has(s.id),
      windowStartMs: this.windowStart(s.timeWindow),
      index,
    }));

    return this.engine.sequence({ stops: optimizerStops, hasDepot, distance });
  }

  private windowStart(timeWindow: unknown): number | null {
    if (timeWindow && typeof timeWindow === 'object' && 'start' in timeWindow) {
      const start = (timeWindow as { start?: unknown }).start;
      if (typeof start === 'string') {
        const t = Date.parse(start);
        return Number.isFinite(t) ? t : null;
      }
    }
    return null;
  }
}
