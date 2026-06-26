import { Injectable, NotFoundException } from '@nestjs/common';
import {
  RESIDENT_ERRORS,
  ResidentStatus,
  type CreateResidentDto,
  type ListResidentsQuery,
  type ResidentListResult,
  type ResidentStatus as ResidentStatusType,
  type ResidentView,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from '../orders/audit.service';

/** The raw resident columns the service maps to a view (kept narrow — PII minimization, §12.2). */
type ResidentRow = { id: string; siteId: string; name: string; room: string | null; status: string; createdAt: Date };

/**
 * Resident directory (Track-B care homes) — create / list-by-site / get. Resident PII (name/room) is
 * sensitive (PRD §12.2): least-privilege (RBAC in the controller + org/site row-scoping here) and
 * EVERY user-facing read writes an immutable audit row. Org-scoping is unforgettable (scopedPrisma);
 * a cross-site (for a confined account principal) or cross-org id never resolves → 404.
 */
@Injectable()
export class ResidentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(principal: RequestPrincipal, dto: CreateResidentDto): Promise<ResidentView> {
    const db = scopedPrisma(this.prisma, principal);
    // The site must be in the principal's scope (a cross-site/cross-org site id → 404, never a write there).
    const site = await db.site.findFirst({ where: { id: dto.siteId }, select: { id: true } });
    if (!site) throw new NotFoundException({ error: RESIDENT_ERRORS.SITE_NOT_FOUND, message: `site ${dto.siteId} not found in scope` });
    const r = await db.resident.create({
      // orgId is also force-pinned by scopedPrisma at runtime; pass it for the type + belt-and-braces.
      data: { orgId: principal.orgId, siteId: dto.siteId, name: dto.name, room: dto.room ?? null, status: ResidentStatus.ACTIVE, createdBy: principal.userId },
    });
    await this.audit.record({
      orgId: principal.orgId,
      actorId: principal.userId,
      entity: 'Resident',
      entityId: r.id,
      action: 'RESIDENT_CREATED',
      after: { siteId: r.siteId, name: r.name, room: r.room },
    });
    return this.toView(r);
  }

  async list(principal: RequestPrincipal, query: ListResidentsQuery): Promise<ResidentListResult> {
    const db = scopedPrisma(this.prisma, principal);
    const site = await db.site.findFirst({ where: { id: query.siteId }, select: { id: true } });
    if (!site) throw new NotFoundException({ error: RESIDENT_ERRORS.SITE_NOT_FOUND, message: `site ${query.siteId} not found in scope` });
    const rows = await db.resident.findMany({
      where: { siteId: query.siteId },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: { id: true, siteId: true, name: true, room: true, status: true, createdAt: true },
    });
    // §12.2 — audit EVERY resident-data read (here: a list, attributed to the site).
    await this.audit.record({
      orgId: principal.orgId,
      actorId: principal.userId,
      entity: 'Resident',
      entityId: query.siteId,
      action: 'RESIDENT_LIST_READ',
      after: { siteId: query.siteId, count: rows.length },
    });
    return { residents: rows.map((r) => this.toView(r)) };
  }

  async get(principal: RequestPrincipal, residentId: string): Promise<ResidentView> {
    const r = await this.requireResident(principal, residentId);
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Resident', entityId: r.id, action: 'RESIDENT_READ' });
    return this.toView(r);
  }

  /**
   * Scope guard reused by the garment flow — resolve a resident inside the principal's scope or 404.
   * This is NOT a user-facing PII read (no display), so it does not itself write an audit row; the
   * user-facing reads (get / list / clothing) audit explicitly.
   */
  async requireResident(principal: RequestPrincipal, residentId: string): Promise<ResidentRow> {
    const db = scopedPrisma(this.prisma, principal);
    const r = await db.resident.findFirst({
      where: { id: residentId },
      select: { id: true, siteId: true, name: true, room: true, status: true, createdAt: true },
    });
    if (!r) throw new NotFoundException({ error: RESIDENT_ERRORS.RESIDENT_NOT_FOUND, message: `resident ${residentId} not found in scope` });
    return r;
  }

  toView(r: ResidentRow): ResidentView {
    return {
      id: r.id,
      siteId: r.siteId,
      name: r.name,
      room: r.room,
      status: r.status as ResidentStatusType,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
