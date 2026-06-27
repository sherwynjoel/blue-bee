import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  GarmentStatus,
  LINEN_ERRORS,
  LinenMovementType,
  ManifestKind,
  RoleScope,
  RoleType,
  RouteStopKind,
  ServiceVertical,
  type AdjustLinenStockDto,
  type GeneratePackToParDto,
  type LinenStockAdjustResult,
  type LinenStockListResult,
  type LinenStockView,
  type ListLinenStockQuery,
  type ListParLevelsQuery,
  type ListPackToParManifestsQuery,
  type ListSoilPickupsQuery,
  type PackToParManifestListResult,
  type PackToParManifestView,
  type PackToParQuery,
  type PackToParView,
  type ParLevelListResult,
  type ParLevelView,
  type RecordSoilPickupDto,
  type ServiceUnit,
  type SetParLevelDto,
  type SoilPickupLineView,
  type SoilPickupListResult,
  type SoilPickupView,
  type UpdateParLevelDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { isOrgWide } from '../auth/rbac/policy';
import { AuditService } from '../orders/audit.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { computePackToParLines, totalGap, type ParInput, type StockInput } from './pack-to-par';

interface ResolvedSite {
  id: string;
  accountId: string;
}
interface LinenServiceMeta {
  id: string;
  name: string;
  unit: ServiceUnit;
}
/** A movement to apply: a SIGNED qty delta to (site, cost-centre?, sku) on-hand. */
interface MovementSpec {
  accountId: string;
  siteId: string;
  costCenterId: string | null;
  serviceId: string;
  type: LinenMovementType;
  qty: number;
  sourceType: string | null;
  sourceId: string | null;
  note?: string | null;
}

/**
 * Facility-linen par loop (Track B Phase 2, PRD §2.2/§5.2/§B3.1/§B3.2). The rental/par half of the
 * care-home vertical: par levels per (site, optional cost-centre) × linen SKU, an append-only on-hand
 * ledger (LinenMovement) with an atomically-maintained on-hand cache (LinenStock), soiled-cart pickup
 * confirmation, and the pack-to-par load sheet (reuses Manifest). Org-scoped via `scopedPrisma`; every
 * mutation pins org_id explicitly inside the transaction and is audited in the same tx (the Track-A
 * pattern). Account principals are confined by row-scoping to their own sites (inverse-scope reads);
 * a cross-account id resolves to null → 404. The plant production floor, RFID, and billing stay DEFERRED.
 */
@Injectable()
export class FacilityLinenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────── par levels ───────────────────────────

  async setPar(principal: RequestPrincipal, siteId: string, dto: SetParLevelDto): Promise<ParLevelView> {
    const site = await this.requireSite(principal, siteId);
    const svc = await this.requireLinenService(principal, dto.serviceId);
    const costCenterId = await this.resolveCostCenterId(principal, dto.costCenterId ?? null, site);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.parLevel.findFirst({
          where: { orgId: principal.orgId, siteId, costCenterId, serviceId: dto.serviceId },
          select: { id: true },
        });
        if (existing) {
          const updated = await tx.parLevel.update({ where: { id: existing.id }, data: { targetQty: dto.targetQty } });
          await this.audit.record(
            { orgId: principal.orgId, actorId: principal.userId, entity: 'ParLevel', entityId: existing.id, action: 'PAR_LEVEL_SET', after: { siteId, costCenterId, serviceId: dto.serviceId, targetQty: dto.targetQty } },
            tx,
          );
          return updated;
        }
        const created = await tx.parLevel.create({
          data: { orgId: principal.orgId, accountId: site.accountId, siteId, costCenterId, serviceId: dto.serviceId, targetQty: dto.targetQty, createdBy: principal.userId },
        });
        await this.audit.record(
          { orgId: principal.orgId, actorId: principal.userId, entity: 'ParLevel', entityId: created.id, action: 'PAR_LEVEL_SET', after: { siteId, costCenterId, serviceId: dto.serviceId, targetQty: dto.targetQty } },
          tx,
        );
        return created;
      });
      return this.toParView(row, svc);
    } catch (err) {
      // A concurrent first-set of the same (site, cost-centre?, sku) loses the NND-unique race → 409.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ error: LINEN_ERRORS.DUPLICATE_PAR, message: `a par level already exists for this site / cost-centre / SKU` });
      }
      throw err;
    }
  }

  async updatePar(principal: RequestPrincipal, parId: string, dto: UpdateParLevelDto): Promise<ParLevelView> {
    const existing = await this.requirePar(principal, parId);
    const svc = await this.requireLinenService(principal, existing.serviceId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.parLevel.update({ where: { id: parId, orgId: principal.orgId }, data: { targetQty: dto.targetQty } });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'ParLevel', entityId: parId, action: 'PAR_LEVEL_UPDATED', before: { targetQty: existing.targetQty }, after: { targetQty: dto.targetQty } },
        tx,
      );
      return row;
    });
    return this.toParView(updated, svc);
  }

  async listPar(principal: RequestPrincipal, siteId: string, query: ListParLevelsQuery): Promise<ParLevelListResult> {
    await this.requireSite(principal, siteId);
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.parLevel.findMany({
      where: { siteId, ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}) },
      orderBy: [{ costCenterId: 'asc' }, { serviceId: 'asc' }],
    });
    const svcMap = await this.serviceMap(principal, rows.map((r) => r.serviceId));
    return { parLevels: rows.map((r) => this.toParView(r, svcMap.get(r.serviceId))) };
  }

  // ─────────────────────────── on-hand stock ───────────────────────────

  async listStock(principal: RequestPrincipal, siteId: string, query: ListLinenStockQuery): Promise<LinenStockListResult> {
    await this.requireSite(principal, siteId);
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.linenStock.findMany({
      where: { siteId, ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}) },
      orderBy: [{ costCenterId: 'asc' }, { serviceId: 'asc' }],
    });
    const svcMap = await this.serviceMap(principal, rows.map((r) => r.serviceId));
    return { stock: rows.map((r) => this.toStockView(r, svcMap.get(r.serviceId))) };
  }

  /** Ops correction: SET on-hand to an absolute target → an ADJUSTMENT movement of (target − current). */
  async adjustStock(principal: RequestPrincipal, siteId: string, dto: AdjustLinenStockDto): Promise<LinenStockAdjustResult> {
    const site = await this.requireSite(principal, siteId);
    const svc = await this.requireLinenService(principal, dto.serviceId);
    const costCenterId = await this.resolveCostCenterId(principal, dto.costCenterId ?? null, site);

    const out = await this.prisma.$transaction(async (tx) => {
      await this.lockCell(tx, principal.orgId, siteId, costCenterId, dto.serviceId);
      const current = await this.readOnHand(tx, principal.orgId, siteId, costCenterId, dto.serviceId);
      const delta = dto.onHand - current;
      const applied = await this.applyMovement(tx, principal, {
        accountId: site.accountId,
        siteId,
        costCenterId,
        serviceId: dto.serviceId,
        type: LinenMovementType.ADJUSTMENT,
        qty: delta,
        sourceType: 'ADJUSTMENT',
        sourceId: null,
        note: dto.note ?? null,
      });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'LinenStock', entityId: applied.movementId, action: 'LINEN_STOCK_ADJUSTED', before: { onHand: current }, after: { onHand: applied.onHand, delta } },
        tx,
      );
      return applied;
    });

    return {
      stock: { siteId, costCenterId, serviceId: dto.serviceId, sku: svc.name, unit: svc.unit, onHand: out.onHand, updatedAt: new Date().toISOString() },
      movement: { id: out.movementId, type: LinenMovementType.ADJUSTMENT, qty: out.qty, occurredAt: new Date().toISOString() },
    };
  }

  // ─────────────────────────── soiled-cart pickup ───────────────────────────

  /** Ops/CSR-confirmed soiled-cart pickup at a site (the SOIL_PICKUP route stop is optional context). */
  async recordSoilPickup(principal: RequestPrincipal, siteId: string, dto: RecordSoilPickupDto): Promise<SoilPickupView> {
    const site = await this.requireSite(principal, siteId);
    if (dto.routeStopId) await this.requirePickupStop(principal, dto.routeStopId, site);
    return this.writeSoilPickup(principal, site, dto, dto.routeStopId ?? null);
  }

  /**
   * Driver self-scoped soiled-cart pickup (Inc-9 template): prove the caller's DRIVER profile OWNS the
   * stop (route.driverId), derive the site from the stop, then delegate to the same write path with an
   * org-scoped copy of the principal (the audit actor stays the driver). The driver-app capture UI is a
   * deferred follow-up — this increment ships the endpoint.
   */
  async recordSoilPickupAsDriver(principal: RequestPrincipal, stopId: string, dto: Omit<RecordSoilPickupDto, 'routeStopId'>): Promise<SoilPickupView> {
    const stop = await this.requireOwnPickupStop(principal, stopId);
    const orgScoped = this.asOrgScoped(principal);
    const site = await this.requireSite(orgScoped, stop.siteId);
    return this.writeSoilPickup(orgScoped, site, dto, stopId, principal.userId);
  }

  private async writeSoilPickup(
    principal: RequestPrincipal,
    site: ResolvedSite,
    dto: Omit<RecordSoilPickupDto, 'routeStopId'>,
    routeStopId: string | null,
    actorIdOverride?: string,
  ): Promise<SoilPickupView> {
    const costCenterId = await this.resolveCostCenterId(principal, dto.costCenterId ?? null, site);
    // Validate + resolve every line's SKU (must be a LINEN service in scope). Lock cells in a stable
    // order (by serviceId) so concurrent pickups can never deadlock.
    const lines = [...dto.lines].sort((a, b) => (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0));
    const svcMap = new Map<string, LinenServiceMeta>();
    for (const l of lines) {
      if (!svcMap.has(l.serviceId)) svcMap.set(l.serviceId, await this.requireLinenService(principal, l.serviceId));
    }
    const actorId = actorIdOverride ?? principal.userId;

    const pickup = await this.prisma.$transaction(async (tx) => {
      const created = await tx.soilPickup.create({
        data: {
          orgId: principal.orgId,
          accountId: site.accountId,
          siteId: site.id,
          costCenterId,
          routeStopId,
          cartCount: dto.cartCount,
          bagCount: dto.bagCount ?? null,
          weightKg: dto.weightKg !== undefined ? new Prisma.Decimal(dto.weightKg.toFixed(2)) : null,
          soiled: dto.soiled ?? true,
          lines: lines.map((l) => ({ serviceId: l.serviceId, qty: l.qty })) as unknown as Prisma.InputJsonValue,
          actorId,
          createdBy: principal.userId,
        },
      });

      // One append-only SOIL_PICKUP movement per SKU (− qty), each decrementing on-hand atomically.
      for (const l of lines) {
        await this.applyMovement(tx, principal, {
          accountId: site.accountId,
          siteId: site.id,
          costCenterId,
          serviceId: l.serviceId,
          type: LinenMovementType.SOIL_PICKUP,
          qty: -l.qty,
          sourceType: 'SOIL_PICKUP',
          sourceId: created.id,
        });
      }

      // The append-only custody checkpoint: cart custody (no item), garmentStage = SOIL_PICKUP.
      await tx.custodyEvent.create({
        data: { orgId: principal.orgId, itemId: null, garmentStage: GarmentStatus.SOIL_PICKUP, actorId, createdBy: principal.userId },
      });

      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId,
          entity: 'SoilPickup',
          entityId: created.id,
          action: 'SOIL_PICKUP_RECORDED',
          after: { siteId: site.id, costCenterId, routeStopId, cartCount: dto.cartCount, pieces: lines.reduce((n, l) => n + l.qty, 0) },
        },
        tx,
      );
      return created;
    });

    return this.toSoilPickupView(pickup, svcMap);
  }

  async listSoilPickups(principal: RequestPrincipal, siteId: string, query: ListSoilPickupsQuery): Promise<SoilPickupListResult> {
    await this.requireSite(principal, siteId);
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.soilPickup.findMany({
      where: { siteId, ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}) },
      orderBy: { occurredAt: 'desc' },
      take: query.limit ?? 50,
    });
    const serviceIds = new Set<string>();
    for (const r of rows) for (const l of this.readPickupLines(r.lines)) serviceIds.add(l.serviceId);
    const svcMap = await this.serviceMap(principal, [...serviceIds]);
    return { pickups: rows.map((r) => this.toSoilPickupView(r, svcMap)) };
  }

  // ─────────────────────────── pack-to-par load sheet ───────────────────────────

  /** Live pack-to-par: gap = max(0, par − on-hand) per SKU, computed now. */
  async packToPar(principal: RequestPrincipal, siteId: string, query: PackToParQuery): Promise<PackToParView> {
    await this.requireSite(principal, siteId);
    const { pars, stock } = await this.loadParAndStock(principal, siteId, query.costCenterId);
    const lines = computePackToParLines(pars, stock, query.costCenterId);
    return { siteId, costCenterId: query.costCenterId ?? null, lines, totalGap: totalGap(lines) };
  }

  /** Snapshot the current pack-to-par gaps into a Manifest (kind = PACK_TO_PAR) — the §B3.2 load sheet. */
  async generatePackToPar(principal: RequestPrincipal, siteId: string, dto: GeneratePackToParDto): Promise<PackToParManifestView> {
    const site = await this.requireSite(principal, siteId);
    const filterCc = dto.costCenterId ?? undefined;
    if (filterCc) await this.resolveCostCenterId(principal, filterCc, site);
    const { pars, stock } = await this.loadParAndStock(principal, siteId, filterCc);
    const lines = computePackToParLines(pars, stock, filterCc);

    const manifest = await this.prisma.$transaction(async (tx) => {
      const row = await tx.manifest.create({
        data: {
          orgId: principal.orgId,
          kind: ManifestKind.PACK_TO_PAR,
          siteId,
          costCenterId: dto.costCenterId ?? null,
          lines: lines as unknown as Prisma.InputJsonValue,
          createdBy: principal.userId,
        },
      });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'Manifest', entityId: row.id, action: 'PACK_TO_PAR_GENERATED', after: { siteId, costCenterId: dto.costCenterId ?? null, lineCount: lines.length, totalGap: totalGap(lines) } },
        tx,
      );
      return row;
    });
    return this.toManifestView(manifest);
  }

  async listPackToParManifests(principal: RequestPrincipal, siteId: string, query: ListPackToParManifestsQuery): Promise<PackToParManifestListResult> {
    await this.requireSite(principal, siteId);
    // Manifests are not row-scoped to accounts; gate access by the already-authorized site (resolved in
    // scope above), then read by site + org + kind explicitly.
    const rows = await this.prisma.manifest.findMany({
      where: { orgId: principal.orgId, siteId, kind: ManifestKind.PACK_TO_PAR },
      orderBy: { generatedAt: 'desc' },
      take: query.limit ?? 20,
    });
    return { manifests: rows.map((r) => this.toManifestView(r)) };
  }

  // ─────────────────────────── ledger primitive (atomic cache) ───────────────────────────

  /**
   * Apply ONE signed movement: append the immutable ledger row, then atomically fold its qty into the
   * on-hand cache. A per-cell transaction advisory lock serializes concurrent movements for the same
   * (site, cost-centre?, sku) so the cache can never be corrupted by interleaving; the cache upsert is an
   * atomic `on_hand += qty` (INSERT … ON CONFLICT DO UPDATE on the NND unique). on_hand == Σ(qty) always.
   */
  private async applyMovement(tx: Prisma.TransactionClient, principal: RequestPrincipal, m: MovementSpec): Promise<{ movementId: string; onHand: number; qty: number }> {
    // Defense-in-depth (mirrors forceWriteScope): a confined principal can never write a movement for an
    // account outside its scope. Today every write path is ops/driver (org-wide), so this never fires —
    // it's a backstop against a future account-principal write path slipping past the role gate.
    if (!isOrgWide(principal.roles) && !principal.accountIds.includes(m.accountId)) {
      throw new ForbiddenException({ error: LINEN_ERRORS.SITE_NOT_FOUND, message: 'cannot write linen movement outside the principal scope' });
    }
    await this.lockCell(tx, principal.orgId, m.siteId, m.costCenterId, m.serviceId);

    const movementId = randomUUID();
    await tx.linenMovement.create({
      data: {
        id: movementId,
        orgId: principal.orgId,
        accountId: m.accountId,
        siteId: m.siteId,
        costCenterId: m.costCenterId,
        serviceId: m.serviceId,
        type: m.type,
        qty: m.qty,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        actorId: principal.userId,
        note: m.note ?? null,
        createdBy: principal.userId,
      },
    });

    const rows = await tx.$queryRaw<{ on_hand: number }[]>(Prisma.sql`
      INSERT INTO "LinenStock" ("id", "org_id", "account_id", "site_id", "cost_center_id", "service_id", "on_hand", "created_at", "updated_at", "created_by")
      VALUES (${randomUUID()}::uuid, ${principal.orgId}::uuid, ${m.accountId}::uuid, ${m.siteId}::uuid, ${m.costCenterId}::uuid, ${m.serviceId}::uuid, ${m.qty}, now(), now(), ${principal.userId}::uuid)
      ON CONFLICT ("site_id", "cost_center_id", "service_id") DO UPDATE SET "on_hand" = "LinenStock"."on_hand" + EXCLUDED."on_hand", "updated_at" = now()
      RETURNING "on_hand" AS "on_hand"
    `);
    return { movementId, onHand: Number(rows[0]?.on_hand ?? 0), qty: m.qty };
  }

  /** Serialize concurrent movements for one (site, cost-centre?, sku) cell (held to commit). */
  private async lockCell(tx: Prisma.TransactionClient, orgId: string, siteId: string, costCenterId: string | null, serviceId: string): Promise<void> {
    // $executeRaw (not $queryRaw) — pg_advisory_xact_lock returns void; we only need the side effect.
    const key = `linen:${orgId}:${siteId}:${costCenterId ?? '∅'}:${serviceId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private async readOnHand(tx: Prisma.TransactionClient, orgId: string, siteId: string, costCenterId: string | null, serviceId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ on_hand: number }[]>(Prisma.sql`
      SELECT "on_hand" FROM "LinenStock"
      WHERE "org_id" = ${orgId}::uuid AND "site_id" = ${siteId}::uuid AND "service_id" = ${serviceId}::uuid
        AND "cost_center_id" IS NOT DISTINCT FROM ${costCenterId}::uuid
    `);
    return Number(rows[0]?.on_hand ?? 0);
  }

  // ─────────────────────────── resolve / scope helpers ───────────────────────────

  private async requireSite(principal: RequestPrincipal, siteId: string): Promise<ResolvedSite> {
    const db = scopedPrisma(this.prisma, principal);
    const site = await db.site.findFirst({ where: { id: siteId }, select: { id: true, accountId: true } });
    if (!site) throw new NotFoundException({ error: LINEN_ERRORS.SITE_NOT_FOUND, message: `site ${siteId} not found in scope` });
    return site;
  }

  private async requireLinenService(principal: RequestPrincipal, serviceId: string): Promise<LinenServiceMeta> {
    const db = scopedPrisma(this.prisma, principal);
    const svc = await db.service.findFirst({ where: { id: serviceId }, select: { id: true, name: true, unit: true, vertical: true } });
    if (!svc) throw new NotFoundException({ error: LINEN_ERRORS.SERVICE_NOT_FOUND, message: `service ${serviceId} not found in scope` });
    if (svc.vertical !== ServiceVertical.LINEN) {
      throw new BadRequestException({ error: LINEN_ERRORS.SERVICE_NOT_LINEN, message: `service ${serviceId} is not a LINEN SKU` });
    }
    return { id: svc.id, name: svc.name, unit: svc.unit as ServiceUnit };
  }

  private async requirePar(principal: RequestPrincipal, parId: string): Promise<{ id: string; serviceId: string; targetQty: number }> {
    const db = scopedPrisma(this.prisma, principal);
    const row = await db.parLevel.findFirst({ where: { id: parId }, select: { id: true, serviceId: true, targetQty: true } });
    if (!row) throw new NotFoundException({ error: LINEN_ERRORS.PAR_LEVEL_NOT_FOUND, message: `par level ${parId} not found in scope` });
    return row;
  }

  /** Resolve + validate an optional cost-centre against the site's account (else 404 / 400 mismatch). */
  private async resolveCostCenterId(principal: RequestPrincipal, costCenterId: string | null, site: ResolvedSite): Promise<string | null> {
    if (!costCenterId) return null;
    const db = scopedPrisma(this.prisma, principal);
    const cc = await db.costCenter.findFirst({ where: { id: costCenterId }, select: { id: true, accountId: true, siteId: true } });
    if (!cc) throw new NotFoundException({ error: LINEN_ERRORS.COST_CENTER_NOT_FOUND, message: `cost centre ${costCenterId} not found in scope` });
    if (cc.accountId !== site.accountId || (cc.siteId !== null && cc.siteId !== site.id)) {
      throw new BadRequestException({ error: LINEN_ERRORS.COST_CENTER_SITE_MISMATCH, message: `cost centre ${costCenterId} does not belong to site ${site.id}` });
    }
    return cc.id;
  }

  /** Resolve a SOIL_PICKUP route stop (a PICKUP/BOTH-kind stop at this site). */
  private async requirePickupStop(principal: RequestPrincipal, stopId: string, site: ResolvedSite): Promise<void> {
    const db = scopedPrisma(this.prisma, principal);
    const stop = await db.routeStop.findFirst({ where: { id: stopId }, select: { id: true, kind: true, siteId: true } });
    if (!stop) throw new NotFoundException({ error: LINEN_ERRORS.ROUTE_STOP_NOT_FOUND, message: `route stop ${stopId} not found in scope` });
    if (stop.kind === RouteStopKind.DELIVERY) {
      throw new BadRequestException({ error: LINEN_ERRORS.ROUTE_STOP_NOT_PICKUP, message: `route stop ${stopId} is not a pickup stop` });
    }
    if (stop.siteId !== site.id) {
      throw new BadRequestException({ error: LINEN_ERRORS.ROUTE_STOP_SITE_MISMATCH, message: `route stop ${stopId} is not at site ${site.id}` });
    }
  }

  /**
   * Driver self-scope: the caller's DRIVER profile must own the stop's ROUTE (the Inc-9 model). A driver is
   * org-staff who serves whatever stops are on their assigned route — across whichever customer accounts
   * those stops belong to — so the authorization is "is this stop on YOUR route?" (route.driverId), NOT an
   * account boundary (drivers are intentionally not account-confined; this mirrors the proven DriverService
   * stop-action gate). A stop NOT on the driver's route → 403. Returns the stop's site for the delegated write.
   */
  private async requireOwnPickupStop(principal: RequestPrincipal, stopId: string): Promise<{ id: string; siteId: string }> {
    const driver = await this.prisma.driver.findFirst({ where: { userId: principal.userId, orgId: principal.orgId }, select: { id: true } });
    if (!driver) throw new ForbiddenException({ error: LINEN_ERRORS.NOT_OWN_STOP, message: 'no driver profile for this user' });
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, orgId: principal.orgId },
      select: { id: true, kind: true, siteId: true, route: { select: { driverId: true } } },
    });
    if (!stop) throw new NotFoundException({ error: LINEN_ERRORS.ROUTE_STOP_NOT_FOUND, message: `route stop ${stopId} not found` });
    if (stop.route?.driverId !== driver.id) throw new ForbiddenException({ error: LINEN_ERRORS.NOT_OWN_STOP, message: 'not a stop on your route' });
    if (stop.kind === RouteStopKind.DELIVERY) {
      throw new BadRequestException({ error: LINEN_ERRORS.ROUTE_STOP_NOT_PICKUP, message: `route stop ${stopId} is not a pickup stop` });
    }
    if (!stop.siteId) throw new BadRequestException({ error: LINEN_ERRORS.ROUTE_STOP_SITE_MISMATCH, message: `route stop ${stopId} has no site` });
    return { id: stop.id, siteId: stop.siteId };
  }

  /** Driver ownership already verified — org-scope the principal for the delegated write (actor unchanged). */
  private asOrgScoped(principal: RequestPrincipal): RequestPrincipal {
    return { ...principal, roles: [{ role: RoleType.DISPATCHER, scope: RoleScope.ORG, scopeId: null }] };
  }

  private async loadParAndStock(principal: RequestPrincipal, siteId: string, costCenterId?: string): Promise<{ pars: ParInput[]; stock: StockInput[] }> {
    const db = scopedPrisma(this.prisma, principal);
    const [pars, stock] = await Promise.all([
      db.parLevel.findMany({ where: { siteId, ...(costCenterId ? { costCenterId } : {}) }, select: { serviceId: true, costCenterId: true, targetQty: true } }),
      db.linenStock.findMany({ where: { siteId, ...(costCenterId ? { costCenterId } : {}) }, select: { serviceId: true, costCenterId: true, onHand: true } }),
    ]);
    const svcMap = await this.serviceMap(principal, pars.map((p) => p.serviceId));
    return {
      pars: pars.map((p) => {
        const svc = svcMap.get(p.serviceId);
        return { serviceId: p.serviceId, costCenterId: p.costCenterId, targetQty: p.targetQty, sku: svc?.name ?? p.serviceId, unit: (svc?.unit ?? 'PIECE') as ServiceUnit };
      }),
      stock: stock.map((s) => ({ serviceId: s.serviceId, costCenterId: s.costCenterId, onHand: s.onHand })),
    };
  }

  private async serviceMap(principal: RequestPrincipal, serviceIds: string[]): Promise<Map<string, LinenServiceMeta>> {
    const ids = [...new Set(serviceIds)];
    if (ids.length === 0) return new Map();
    const db = scopedPrisma(this.prisma, principal);
    const svcs = await db.service.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } });
    return new Map(svcs.map((s) => [s.id, { id: s.id, name: s.name, unit: s.unit as ServiceUnit }]));
  }

  // ─────────────────────────── view mappers ───────────────────────────

  private toParView(r: { id: string; accountId: string; siteId: string; costCenterId: string | null; serviceId: string; targetQty: number; createdAt: Date; updatedAt: Date }, svc?: LinenServiceMeta): ParLevelView {
    return {
      id: r.id,
      accountId: r.accountId,
      siteId: r.siteId,
      costCenterId: r.costCenterId,
      serviceId: r.serviceId,
      sku: svc?.name ?? r.serviceId,
      unit: (svc?.unit ?? 'PIECE') as ServiceUnit,
      targetQty: r.targetQty,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toStockView(r: { siteId: string; costCenterId: string | null; serviceId: string; onHand: number; updatedAt: Date }, svc?: LinenServiceMeta): LinenStockView {
    return {
      siteId: r.siteId,
      costCenterId: r.costCenterId,
      serviceId: r.serviceId,
      sku: svc?.name ?? r.serviceId,
      unit: (svc?.unit ?? 'PIECE') as ServiceUnit,
      onHand: r.onHand,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private readPickupLines(lines: Prisma.JsonValue): Array<{ serviceId: string; qty: number }> {
    if (!Array.isArray(lines)) return [];
    return lines.flatMap((l) => (l && typeof l === 'object' && 'serviceId' in l && 'qty' in l ? [{ serviceId: String((l as { serviceId: unknown }).serviceId), qty: Number((l as { qty: unknown }).qty) }] : []));
  }

  private toSoilPickupView(
    r: { id: string; siteId: string; costCenterId: string | null; routeStopId: string | null; cartCount: number; bagCount: number | null; weightKg: Prisma.Decimal | null; soiled: boolean; lines: Prisma.JsonValue; actorId: string | null; occurredAt: Date },
    svcMap: Map<string, LinenServiceMeta>,
  ): SoilPickupView {
    const lines: SoilPickupLineView[] = this.readPickupLines(r.lines).map((l) => {
      const svc = svcMap.get(l.serviceId);
      return { serviceId: l.serviceId, sku: svc?.name ?? l.serviceId, unit: (svc?.unit ?? 'PIECE') as ServiceUnit, qty: l.qty };
    });
    return {
      id: r.id,
      siteId: r.siteId,
      costCenterId: r.costCenterId,
      routeStopId: r.routeStopId,
      cartCount: r.cartCount,
      bagCount: r.bagCount,
      weightKg: r.weightKg === null ? null : r.weightKg.toFixed(2),
      soiled: r.soiled,
      lines,
      totalPieces: lines.reduce((n, l) => n + l.qty, 0),
      actorId: r.actorId,
      occurredAt: r.occurredAt.toISOString(),
    };
  }

  private toManifestView(r: { id: string; siteId: string | null; costCenterId: string | null; kind: string; lines: Prisma.JsonValue; generatedAt: Date }): PackToParManifestView {
    const lines = Array.isArray(r.lines) ? (r.lines as unknown as PackToParManifestView['lines']) : [];
    return {
      id: r.id,
      siteId: r.siteId ?? '',
      costCenterId: r.costCenterId,
      kind: r.kind as ManifestKind,
      lines,
      totalGap: lines.reduce((n, l) => n + (l?.gap ?? 0), 0),
      generatedAt: r.generatedAt.toISOString(),
    };
  }
}
