import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  GARMENT_BRANCH_STATUSES,
  GarmentStatus,
  ItemKind,
  LostFoundStatus,
  RESIDENT_ERRORS,
  TagBinding,
  TagType,
  bucketForGarment,
  canTransitionGarment,
  type DropToLostFoundDto,
  type EnrollGarmentDto,
  type GarmentView,
  type LostFoundItemView,
  type LostFoundPoolResult,
  type ReconcileDto,
  type ReconciliationReport,
  type ResidentClothingView,
  type TransitionGarmentDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from '../orders/audit.service';
import { ResidentService } from './resident.service';

/** Item row shape the garment views map from (with the tag code + the owning resident's site). */
type GarmentRow = {
  id: string;
  residentId: string | null;
  tagId: string | null;
  garmentStatus: GarmentStatus | null;
  measurements: Prisma.JsonValue;
  updatedAt: Date;
  tag: { code: string } | null;
  resident?: { id: string; siteId: string } | null;
};
type LostFoundRow = {
  id: string;
  siteId: string;
  status: string;
  itemId: string | null;
  candidateResidentId: string | null;
  notes: string | null;
  reconciledAt: Date | null;
  createdAt: Date;
  item: { garmentStatus: GarmentStatus | null; tag: { code: string } | null } | null;
  candidateResident: { name: string } | null;
};

const LF_INCLUDE = {
  item: { select: { garmentStatus: true, tag: { select: { code: true } } } },
  candidateResident: { select: { name: true } },
} satisfies Prisma.LostFoundItemInclude;

/**
 * Resident-garment lifecycle (Track-B care homes, PRD §5.2-B) — server-authoritative transitions over
 * the existing custody backbone. Every move writes an APPEND-ONLY CustodyEvent (who/when/garmentStage);
 * an illegal transition → 409 (`canTransitionGarment` is the single guard, shared with the UI). The odd
 * item branch drops a garment into the site's lost & found pool and `reconcile` assigns it back to a
 * resident. Reads that expose resident PII are audited (§12.2). Scope is verified via scopedPrisma
 * BEFORE each mutation; inside `$transaction` org_id is pinned explicitly (the scoped client does not
 * reach into a transaction).
 */
@Injectable()
export class GarmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly residents: ResidentService,
  ) {}

  /** Enroll a garment to a resident (tag↔resident → GARMENT_ENROLLED) + opening custody event. */
  async enroll(principal: RequestPrincipal, residentId: string, dto: EnrollGarmentDto): Promise<GarmentView> {
    await this.residents.requireResident(principal, residentId); // 404 if out of scope
    const orgId = principal.orgId;
    const item = await this.prisma.$transaction(async (tx) => {
      // Resolve (or create) the resident-bound tag; a code already on an item is a conflict.
      const existingTag = await tx.tag.findFirst({ where: { orgId, code: dto.tagCode }, select: { id: true, item: { select: { id: true } } } });
      let tagId: string;
      if (existingTag) {
        if (existingTag.item) throw new ConflictException({ error: RESIDENT_ERRORS.TAG_IN_USE, message: `tag ${dto.tagCode} is already bound to an item` });
        tagId = existingTag.id;
      } else {
        const tag = await tx.tag.create({ data: { orgId, code: dto.tagCode, type: TagType.QR, boundTo: TagBinding.RESIDENT, active: true, createdBy: principal.userId } });
        tagId = tag.id;
      }
      const created = await tx.item.create({
        data: {
          orgId,
          residentId,
          tagId,
          kind: ItemKind.GARMENT,
          garmentStatus: GarmentStatus.GARMENT_ENROLLED,
          measurements: (dto.description ? { description: dto.description } : {}) as Prisma.InputJsonValue,
          createdBy: principal.userId,
        },
        include: { tag: { select: { code: true } } },
      });
      await tx.custodyEvent.create({ data: { orgId, itemId: created.id, garmentStage: GarmentStatus.GARMENT_ENROLLED, actorId: principal.userId, createdBy: principal.userId } });
      await this.audit.record({ orgId, actorId: principal.userId, entity: 'Item', entityId: created.id, action: 'GARMENT_ENROLLED', after: { residentId, tagCode: dto.tagCode, garmentStatus: GarmentStatus.GARMENT_ENROLLED } }, tx);
      return created;
    });
    return this.toGarmentView(item as GarmentRow);
  }

  /** A LINEAR §5.2-B transition (branch targets are rejected → use the dedicated endpoints). 409 if illegal. */
  async transition(principal: RequestPrincipal, garmentId: string, dto: TransitionGarmentDto): Promise<GarmentView> {
    const garment = await this.requireGarment(principal, garmentId);
    const to = dto.to;
    if (GARMENT_BRANCH_STATUSES.includes(to)) {
      throw new BadRequestException({ error: RESIDENT_ERRORS.USE_LOST_FOUND_ENDPOINT, message: `${to} is reached via the dedicated lost-found / reconcile endpoint, not transition` });
    }
    const from = garment.garmentStatus as GarmentStatus;
    if (!canTransitionGarment(from, to)) {
      throw new ConflictException({ error: RESIDENT_ERRORS.ILLEGAL_GARMENT_TRANSITION, message: `illegal garment transition ${from} → ${to}` });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap on the from-state: a concurrent transition that already moved off `from`
      // loses the race → 409 (no lost update; the lifecycle can't be corrupted by interleaving).
      const moved = await tx.item.updateMany({
        where: { id: garmentId, orgId: principal.orgId, kind: ItemKind.GARMENT, garmentStatus: from },
        data: { garmentStatus: to },
      });
      if (moved.count !== 1) {
        throw new ConflictException({ error: RESIDENT_ERRORS.CONCURRENT_MODIFICATION, message: `garment ${garmentId} was concurrently modified` });
      }
      await tx.custodyEvent.create({ data: { orgId: principal.orgId, itemId: garmentId, garmentStage: to, actorId: principal.userId, createdBy: principal.userId } });
      await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Item', entityId: garmentId, action: 'GARMENT_TRANSITION', before: { garmentStatus: from }, after: { garmentStatus: to } }, tx);
      return tx.item.findUniqueOrThrow({ where: { id: garmentId }, include: { tag: { select: { code: true } } } });
    });
    return this.toGarmentView(updated as GarmentRow);
  }

  /** Drop an odd/unmatched garment into the site's lost & found pool (RETURN_SORT → LOST_FOUND_POOL). */
  async dropToLostFound(principal: RequestPrincipal, garmentId: string, dto: DropToLostFoundDto): Promise<LostFoundItemView> {
    const garment = await this.requireGarment(principal, garmentId);
    const from = garment.garmentStatus as GarmentStatus;
    if (!canTransitionGarment(from, GarmentStatus.LOST_FOUND_POOL)) {
      throw new ConflictException({ error: RESIDENT_ERRORS.ILLEGAL_GARMENT_TRANSITION, message: `illegal garment transition ${from} → LOST_FOUND_POOL` });
    }
    const siteId = garment.resident?.siteId;
    if (!siteId) throw new ConflictException({ error: RESIDENT_ERRORS.GARMENT_NOT_FOUND, message: 'garment has no resident/site to pool against' });
    const lf = await this.prisma.$transaction(async (tx) => {
      // CAS — only pool the garment if it is still in `from` (no double-pool / two OPEN rows under concurrency).
      const moved = await tx.item.updateMany({
        where: { id: garmentId, orgId: principal.orgId, kind: ItemKind.GARMENT, garmentStatus: from },
        data: { garmentStatus: GarmentStatus.LOST_FOUND_POOL },
      });
      if (moved.count !== 1) {
        throw new ConflictException({ error: RESIDENT_ERRORS.CONCURRENT_MODIFICATION, message: `garment ${garmentId} was concurrently modified` });
      }
      const created = await tx.lostFoundItem.create({
        data: { orgId: principal.orgId, siteId, itemId: garmentId, tagId: garment.tagId, candidateResidentId: garment.residentId, status: LostFoundStatus.OPEN, notes: dto.notes ?? null, createdBy: principal.userId },
        include: LF_INCLUDE,
      });
      await tx.custodyEvent.create({ data: { orgId: principal.orgId, itemId: garmentId, garmentStage: GarmentStatus.LOST_FOUND_POOL, actorId: principal.userId, createdBy: principal.userId } });
      await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'LostFoundItem', entityId: created.id, action: 'GARMENT_LOST_FOUND', after: { itemId: garmentId, siteId, candidateResidentId: garment.residentId } }, tx);
      return created;
    });
    return this.toLostFoundView(lf as LostFoundRow);
  }

  /** Reconcile a pooled garment back to a resident (LOST_FOUND_POOL → RECONCILE) + custody. */
  async reconcile(principal: RequestPrincipal, lostFoundId: string, dto: ReconcileDto): Promise<GarmentView> {
    const db = scopedPrisma(this.prisma, principal);
    const lf = await db.lostFoundItem.findFirst({ where: { id: lostFoundId }, select: { id: true, status: true, itemId: true, siteId: true, item: { select: { garmentStatus: true } } } });
    if (!lf) throw new NotFoundException({ error: RESIDENT_ERRORS.LOST_FOUND_NOT_FOUND, message: `lost & found item ${lostFoundId} not found in scope` });
    if (lf.status !== LostFoundStatus.OPEN) throw new ConflictException({ error: RESIDENT_ERRORS.ALREADY_RECONCILED, message: 'lost & found item is already reconciled' });
    if (!lf.itemId || lf.item?.garmentStatus !== GarmentStatus.LOST_FOUND_POOL) {
      throw new ConflictException({ error: RESIDENT_ERRORS.NOT_IN_POOL, message: 'the pooled garment is not in LOST_FOUND_POOL' });
    }
    // The target resident must be in scope (a cross-site/cross-org resident → 404) AND at the SAME site
    // as the pooled garment — a garment found at one wing/site can't be reconciled to another site's resident.
    const resident = await this.residents.requireResident(principal, dto.residentId);
    if (resident.siteId !== lf.siteId) {
      throw new BadRequestException({ error: RESIDENT_ERRORS.RESIDENT_SITE_MISMATCH, message: 'resident is at a different site than the pooled garment' });
    }
    const itemId = lf.itemId;
    const garment = await this.prisma.$transaction(async (tx) => {
      // CAS the pool row OPEN→RECONCILED — the atomic gate; only one concurrent caller wins (no double-reconcile).
      const claimed = await tx.lostFoundItem.updateMany({
        where: { id: lostFoundId, orgId: principal.orgId, status: LostFoundStatus.OPEN },
        data: { status: LostFoundStatus.RECONCILED, reconciledAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({ error: RESIDENT_ERRORS.ALREADY_RECONCILED, message: 'lost & found item was concurrently reconciled' });
      }
      // CAS the pooled garment LOST_FOUND_POOL→RECONCILE — guards it hasn't moved out of the pool meanwhile.
      const moved = await tx.item.updateMany({
        where: { id: itemId, orgId: principal.orgId, garmentStatus: GarmentStatus.LOST_FOUND_POOL },
        data: { residentId: dto.residentId, garmentStatus: GarmentStatus.RECONCILE },
      });
      if (moved.count !== 1) {
        throw new ConflictException({ error: RESIDENT_ERRORS.NOT_IN_POOL, message: 'the pooled garment changed before reconcile' });
      }
      await tx.custodyEvent.create({ data: { orgId: principal.orgId, itemId, garmentStage: GarmentStatus.RECONCILE, actorId: principal.userId, createdBy: principal.userId } });
      await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Item', entityId: itemId, action: 'GARMENT_RECONCILED', after: { residentId: dto.residentId, lostFoundId } }, tx);
      return tx.item.findUniqueOrThrow({ where: { id: itemId }, include: { tag: { select: { code: true } } } });
    });
    return this.toGarmentView(garment as GarmentRow);
  }

  /** The A4.2 view — a resident's garments in the four buckets (enrolled / in-process / returned / lost&found). Audited. */
  async residentClothing(principal: RequestPrincipal, residentId: string): Promise<ResidentClothingView> {
    const resident = await this.residents.requireResident(principal, residentId);
    const db = scopedPrisma(this.prisma, principal);
    const garments = await db.item.findMany({
      where: { residentId, kind: ItemKind.GARMENT },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, residentId: true, tagId: true, garmentStatus: true, measurements: true, updatedAt: true, tag: { select: { code: true } } },
    });
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Resident', entityId: residentId, action: 'RESIDENT_CLOTHING_READ', after: { garmentCount: garments.length } });
    const buckets: ResidentClothingView['buckets'] = { enrolled: [], inProcess: [], returned: [], lostFound: [] };
    for (const g of garments) {
      if (!g.garmentStatus) continue;
      buckets[bucketForGarment(g.garmentStatus as GarmentStatus)].push(this.toGarmentView(g as GarmentRow));
    }
    return { resident: this.residents.toView(resident), buckets };
  }

  /** The site's OPEN lost & found pool. Audited (candidate resident names are resident-adjacent PII). */
  async lostFoundPool(principal: RequestPrincipal, siteId: string): Promise<LostFoundPoolResult> {
    await this.requireSite(principal, siteId);
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.lostFoundItem.findMany({ where: { siteId, status: LostFoundStatus.OPEN }, orderBy: { createdAt: 'desc' }, include: LF_INCLUDE });
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'LostFoundItem', entityId: siteId, action: 'LOST_FOUND_READ', after: { siteId, count: rows.length } });
    return { lostFound: rows.map((r) => this.toLostFoundView(r as LostFoundRow)) };
  }

  /** Reconciliation report for a site (B3.3) — open/reconciled counts + the items. Audited. */
  async reconciliationReport(principal: RequestPrincipal, siteId: string): Promise<ReconciliationReport> {
    await this.requireSite(principal, siteId);
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.lostFoundItem.findMany({ where: { siteId }, orderBy: { createdAt: 'desc' }, include: LF_INCLUDE });
    const open = rows.filter((r) => r.status === LostFoundStatus.OPEN).length;
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'LostFoundItem', entityId: siteId, action: 'LOST_FOUND_REPORT_READ', after: { siteId, total: rows.length } });
    return { siteId, open, reconciled: rows.length - open, total: rows.length, items: rows.map((r) => this.toLostFoundView(r as LostFoundRow)) };
  }

  // ───────────── scope guards + mappers ─────────────

  private async requireGarment(principal: RequestPrincipal, garmentId: string): Promise<GarmentRow> {
    const db = scopedPrisma(this.prisma, principal);
    const g = await db.item.findFirst({
      where: { id: garmentId, kind: ItemKind.GARMENT },
      select: { id: true, residentId: true, tagId: true, garmentStatus: true, measurements: true, updatedAt: true, tag: { select: { code: true } }, resident: { select: { id: true, siteId: true } } },
    });
    if (!g || !g.garmentStatus) throw new NotFoundException({ error: RESIDENT_ERRORS.GARMENT_NOT_FOUND, message: `garment ${garmentId} not found in scope` });
    return g as GarmentRow;
  }

  private async requireSite(principal: RequestPrincipal, siteId: string): Promise<void> {
    const db = scopedPrisma(this.prisma, principal);
    const s = await db.site.findFirst({ where: { id: siteId }, select: { id: true } });
    if (!s) throw new NotFoundException({ error: RESIDENT_ERRORS.SITE_NOT_FOUND, message: `site ${siteId} not found in scope` });
  }

  private toGarmentView(item: GarmentRow): GarmentView {
    const measurements = (item.measurements ?? {}) as { description?: string };
    return {
      id: item.id,
      residentId: item.residentId,
      tagCode: item.tag?.code ?? null,
      garmentStatus: item.garmentStatus as GarmentStatus,
      description: measurements.description ?? null,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toLostFoundView(lf: LostFoundRow): LostFoundItemView {
    return {
      id: lf.id,
      siteId: lf.siteId,
      status: lf.status as LostFoundStatus,
      itemId: lf.itemId,
      tagCode: lf.item?.tag?.code ?? null,
      garmentStatus: (lf.item?.garmentStatus as GarmentStatus | null) ?? null,
      candidateResidentId: lf.candidateResidentId,
      candidateResidentName: lf.candidateResident?.name ?? null,
      notes: lf.notes,
      reconciledAt: lf.reconciledAt?.toISOString() ?? null,
      createdAt: lf.createdAt.toISOString(),
    };
  }
}
