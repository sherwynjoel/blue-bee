import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LastKnownPosition } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Breadcrumb history (PRD §6.2 "Breadcrumb history: Timescale", §10.4). Appends every
 * accepted ping to the `GpsPing` TimescaleDB hypertable — the replay/audit record — and
 * serves the latest-per-vehicle row as the fallback when Redis has no last-known.
 *
 * Writes are real, parameterized raw SQL (the geo column is PostGIS `geography(Point,4326)`,
 * which Prisma models as `Unsupported`, so it must be set via `ST_MakePoint`). The whole
 * batch is ONE multi-row INSERT — atomic, no partial write — with
 * `ON CONFLICT (vehicle_id, recorded_at) DO NOTHING` so a replayed/duplicate batch appends
 * zero rows. Every row carries an explicit `org_id`, and reads filter by `org_id` — no
 * reliance on the scoped-Prisma extension (the Increment-4 in-transaction scoping lesson).
 */

export interface HistoryRow {
  id: string;
  orgId: string;
  shiftId: string;
  vehicleId: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  recordedAt: Date;
  createdBy: string | null;
}

interface LatestRow {
  vehicleId: string;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  heading: number | null;
  recordedAt: Date;
}

@Injectable()
export class GpsHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append a batch of pings to the hypertable. Returns the number of rows actually inserted
   * (0 when every ping already existed — a replay). Idempotent by (vehicle_id, recorded_at).
   */
  async appendBatch(rows: HistoryRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const values = rows.map(
      (r) => Prisma.sql`(
        ${r.id}::uuid, ${r.orgId}::uuid, ${r.shiftId}::uuid, ${r.vehicleId}::uuid,
        ST_SetSRID(ST_MakePoint(${r.lng}, ${r.lat}), 4326)::geography,
        ${r.speed}, ${r.heading}, ${r.recordedAt}, now(), now(), ${r.createdBy}::uuid
      )`,
    );
    const inserted = await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "GpsPing"
        ("id", "org_id", "shift_id", "vehicle_id", "geo", "speed", "heading", "recorded_at", "created_at", "updated_at", "created_by")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("vehicle_id", "recorded_at") DO NOTHING
    `);
    return inserted;
  }

  /**
   * Latest ping per vehicle from the hypertable (the Redis fallback). Scoped to `orgId` and
   * the given vehicle ids. Vehicles with no ping (or a null geo) are simply absent from the map.
   */
  async latestForVehicles(orgId: string, vehicleIds: string[]): Promise<Map<string, LastKnownPosition>> {
    const out = new Map<string, LastKnownPosition>();
    if (vehicleIds.length === 0) return out;
    const idList = Prisma.join(vehicleIds.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await this.prisma.$queryRaw<LatestRow[]>(Prisma.sql`
      SELECT DISTINCT ON (vehicle_id)
        vehicle_id::text AS "vehicleId",
        ST_Y(geo::geometry)::float8 AS "lat",
        ST_X(geo::geometry)::float8 AS "lng",
        speed AS "speed",
        heading AS "heading",
        recorded_at AS "recordedAt"
      FROM "GpsPing"
      WHERE org_id = ${orgId}::uuid AND vehicle_id IN (${idList})
      ORDER BY vehicle_id, recorded_at DESC
    `);
    for (const r of rows) {
      if (r.lat === null || r.lng === null) continue;
      const recordedAtMs = r.recordedAt.getTime();
      out.set(r.vehicleId, {
        vehicleId: r.vehicleId,
        lat: r.lat,
        lng: r.lng,
        speed: r.speed,
        heading: r.heading,
        recordedAt: r.recordedAt.toISOString(),
        ageSeconds: Math.max(0, Math.floor((Date.now() - recordedAtMs) / 1000)),
        source: 'timescale',
      });
    }
    return out;
  }

  /** Latest ping for a single vehicle (Redis fallback for the customer tracking poll). */
  async latestForVehicle(orgId: string, vehicleId: string): Promise<LastKnownPosition | null> {
    return (await this.latestForVehicles(orgId, [vehicleId])).get(vehicleId) ?? null;
  }
}
