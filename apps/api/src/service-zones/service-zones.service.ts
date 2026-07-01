import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  ZONE_ERRORS,
  type CoverageRequestView,
  type CoverageRequestsResult,
  type CreateServiceZoneDto,
  type GeoPolygon,
  type ListCoverageRequestsQuery,
  type ServiceZoneView,
  type ServiceZonesResult,
  type UpdateServiceZoneDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../orders/audit.service';
import type { RequestPrincipal } from '../auth/rbac/types';

/** A WGS84 service point. */
export interface ZonePoint {
  lng: number;
  lat: number;
}

/** The one-query serviceability answer used at booking. */
export interface Serviceability {
  /** Does the org have ≥ 1 ACTIVE zone? (No active zones ⇒ the org serves everywhere — gate is inert.) */
  hasActiveZones: boolean;
  /** Is the point inside ≥ 1 active zone? (ST_Covers — boundary-inclusive.) */
  covered: boolean;
}

type ZoneRow = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  area_geojson: string | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * Service zones + out-of-area demand capture (Increment 19). Owner/finance draw polygon service zones (real
 * PostGIS geography(Polygon,4326)); a booking whose service point falls outside every ACTIVE zone is blocked
 * and captured as a CoverageRequest. Follows the as-built raw-PostGIS pattern (PricingAccountService.matchBuilding
 * / CorporateService building geo): the polygon column is Prisma `Unsupported`, so it is set via
 * `ST_GeomFromGeoJSON` (raw $executeRaw) and read via `ST_AsGeoJSON` (raw $queryRaw); the containment check is a
 * raw `ST_Covers`. All reads/writes are org-scoped explicitly (`org_id = ${orgId}::uuid`) — a new org-only
 * model needs no scopedPrisma entry; raw SQL is org-scoped by hand exactly like matchBuilding.
 */
@Injectable()
export class ServiceZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────── zone management (OWNER/FINANCE) ───────────────────────────

  async listZones(principal: RequestPrincipal): Promise<ServiceZonesResult> {
    const rows = await this.prisma.$queryRaw<ZoneRow[]>(Prisma.sql`
      SELECT id, name, active, sort_order, ST_AsGeoJSON(area) AS area_geojson, created_at, updated_at
      FROM "ServiceZone"
      WHERE org_id = ${principal.orgId}::uuid
      ORDER BY sort_order ASC, created_at ASC`);
    return { zones: rows.map((r) => this.toZoneView(r)) };
  }

  async getZone(principal: RequestPrincipal, zoneId: string): Promise<ServiceZoneView> {
    const row = await this.readZone(principal.orgId, zoneId);
    if (!row) throw new NotFoundException({ error: ZONE_ERRORS.ZONE_NOT_FOUND, message: `service zone ${zoneId} not found in scope` });
    return this.toZoneView(row);
  }

  async createZone(principal: RequestPrincipal, dto: CreateServiceZoneDto): Promise<ServiceZoneView> {
    await this.assertValidPolygon(dto.polygon);
    const zoneId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceZone.create({
        data: {
          id: zoneId,
          orgId: principal.orgId,
          name: dto.name,
          active: dto.active ?? true,
          sortOrder: dto.sortOrder ?? 0,
          createdBy: principal.userId,
        },
      });
      // geography(Polygon,4326) is Prisma `Unsupported` → set via raw SQL from the GeoJSON (the as-built pattern).
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ServiceZone" SET area = ${this.areaSql(dto.polygon)}
        WHERE id = ${zoneId}::uuid AND org_id = ${principal.orgId}::uuid`);
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'ServiceZone',
          entityId: zoneId,
          action: 'SERVICE_ZONE_CREATED',
          after: { name: dto.name, active: dto.active ?? true, sortOrder: dto.sortOrder ?? 0, polygon: dto.polygon },
        },
        tx,
      );
    });
    return this.getZone(principal, zoneId);
  }

  async updateZone(principal: RequestPrincipal, zoneId: string, dto: UpdateServiceZoneDto): Promise<ServiceZoneView> {
    // Cross-org → 404 (scoped miss); mirrors the corporate requireCorporateAccount pattern.
    const existing = await this.readZone(principal.orgId, zoneId);
    if (!existing) throw new NotFoundException({ error: ZONE_ERRORS.ZONE_NOT_FOUND, message: `service zone ${zoneId} not found in scope` });
    if (dto.polygon) await this.assertValidPolygon(dto.polygon);

    await this.prisma.$transaction(async (tx) => {
      await tx.serviceZone.update({
        where: { id: zoneId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      if (dto.polygon) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "ServiceZone" SET area = ${this.areaSql(dto.polygon)}
          WHERE id = ${zoneId}::uuid AND org_id = ${principal.orgId}::uuid`);
      }
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'ServiceZone',
          entityId: zoneId,
          action: 'SERVICE_ZONE_UPDATED',
          after: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.active !== undefined ? { active: dto.active } : {}),
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
            ...(dto.polygon ? { redrawn: true } : {}),
          },
        },
        tx,
      );
    });
    return this.getZone(principal, zoneId);
  }

  // ─────────────────────────── booking-time serviceability + demand capture ───────────────────────────

  /** ONE round-trip: does the org have active zones, and is `point` inside one? (boundary-inclusive ST_Covers). */
  async isServiceable(orgId: string, point: ZonePoint): Promise<Serviceability> {
    const rows = await this.prisma.$queryRaw<Array<{ has_active: boolean; covered: boolean }>>(Prisma.sql`
      SELECT
        EXISTS (
          SELECT 1 FROM "ServiceZone" WHERE org_id = ${orgId}::uuid AND active = true
        ) AS has_active,
        EXISTS (
          SELECT 1 FROM "ServiceZone"
          WHERE org_id = ${orgId}::uuid AND active = true
            AND area IS NOT NULL
            AND ST_Covers(area, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography)
        ) AS covered`);
    const row = rows[0];
    return { hasActiveZones: row?.has_active ?? false, covered: row?.covered ?? false };
  }

  /**
   * Capture the out-of-zone demand. Idempotent-ish for retried blocked attempts: reuse a request from the SAME
   * user for the SAME point (≤ 5 m) in the last 10 minutes instead of inserting a duplicate (lens 5 — exactly
   * one row per blocked booking, no orphan/dup). Its own commit, called BEFORE the 422 is thrown so a failed
   * write means no 422 + no row (the app never claims "listed" falsely). Returns the CoverageRequest id.
   */
  async captureCoverageRequest(input: {
    orgId: string;
    userId: string;
    point: ZonePoint;
    address: string | null;
    context: Record<string, unknown> | null;
  }): Promise<string> {
    const { orgId, userId, point, address, context } = input;
    const dup = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "CoverageRequest"
      WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND point IS NOT NULL
        AND ST_DWithin(point, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography, 5)
        AND created_at > now() - interval '10 minutes'
      ORDER BY created_at DESC LIMIT 1`);
    if (dup[0]) return dup[0].id;

    const id = randomUUID();
    const contextJson = context ? JSON.stringify(context) : null;
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "CoverageRequest" (id, org_id, user_id, address, point, context, created_at, updated_at, created_by)
      VALUES (
        ${id}::uuid, ${orgId}::uuid, ${userId}::uuid, ${address},
        ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography,
        ${contextJson}::jsonb, now(), now(), ${userId}::uuid
      )`);
    return id;
  }

  // ─────────────────────────── coverage-request read (OWNER/FINANCE, cursor) ───────────────────────────

  async listCoverageRequests(principal: RequestPrincipal, query: ListCoverageRequestsQuery): Promise<CoverageRequestsResult> {
    const cursor = query.cursor ?? null;
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; user_id: string; address: string | null; lat: number | null; lng: number | null; context: unknown; created_at: Date }>
    >(Prisma.sql`
      SELECT id, user_id, address, ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng, context, created_at
      FROM "CoverageRequest"
      WHERE org_id = ${principal.orgId}::uuid
        AND (
          ${cursor}::uuid IS NULL
          OR (created_at, id) < (SELECT created_at, id FROM "CoverageRequest" WHERE id = ${cursor}::uuid AND org_id = ${principal.orgId}::uuid)
        )
      ORDER BY created_at DESC, id DESC
      LIMIT ${query.limit + 1}`);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const coverageRequests: CoverageRequestView[] = page.map((r) => ({
      id: r.id,
      userId: r.user_id,
      address: r.address,
      lng: r.lng === null ? 0 : Number(r.lng),
      lat: r.lat === null ? 0 : Number(r.lat),
      context: (r.context as Record<string, unknown> | null) ?? null,
      createdAt: r.created_at.toISOString(),
    }));
    return { coverageRequests, nextCursor: hasMore ? page[page.length - 1]!.id : null, hasMore };
  }

  // ─────────────────────────── helpers ───────────────────────────

  /** Build the geography(Polygon,4326) SQL from a GeoJSON polygon (SRID enforced; cast to geography). */
  private areaSql(polygon: GeoPolygon): Prisma.Sql {
    return Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(polygon)}), 4326)::geography`;
  }

  /** Final geometry gate: PostGIS ST_IsValid (rejects self-intersecting/degenerate rings zod can't catch). */
  private async assertValidPolygon(polygon: GeoPolygon): Promise<void> {
    let valid = false;
    let reason = 'unparseable geometry';
    try {
      const rows = await this.prisma.$queryRaw<Array<{ valid: boolean; reason: string }>>(Prisma.sql`
        SELECT ST_IsValid(g) AS valid, ST_IsValidReason(g) AS reason
        FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(polygon)}), 4326) AS g) s`);
      valid = rows[0]?.valid ?? false;
      reason = rows[0]?.reason ?? reason;
    } catch {
      // ST_GeomFromGeoJSON threw (structurally bad geometry that passed the zod shape check) → treat as invalid.
      valid = false;
    }
    if (!valid) {
      throw new BadRequestException({ error: ZONE_ERRORS.INVALID_POLYGON, message: `invalid polygon: ${reason}` });
    }
  }

  private async readZone(orgId: string, zoneId: string): Promise<ZoneRow | null> {
    const rows = await this.prisma.$queryRaw<ZoneRow[]>(Prisma.sql`
      SELECT id, name, active, sort_order, ST_AsGeoJSON(area) AS area_geojson, created_at, updated_at
      FROM "ServiceZone"
      WHERE id = ${zoneId}::uuid AND org_id = ${orgId}::uuid
      LIMIT 1`);
    return rows[0] ?? null;
  }

  private toZoneView(row: ZoneRow): ServiceZoneView {
    return {
      id: row.id,
      name: row.name,
      active: row.active,
      sortOrder: Number(row.sort_order),
      polygon: (row.area_geojson ? JSON.parse(row.area_geojson) : { type: 'Polygon', coordinates: [] }) as GeoPolygon,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
