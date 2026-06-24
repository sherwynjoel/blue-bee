import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from '../orders/audit.service';
import { LogisticsAccessService } from './logistics-access.service';

/**
 * Manifest generation (PRD §6.3 load sheet / §9.5 Manifest). For Phase-1 specialty a
 * pickup-stop manifest is the list of the linked order's items (tag + kind) the driver
 * is expected to collect — the real check-list used to validate the pickup against what
 * is actually scanned (the scan/tally lands with the driver app in a later increment).
 */
@Injectable()
export class ManifestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: LogisticsAccessService,
  ) {}

  /** Generate (snapshot) the manifest for a single stop. */
  async generateForStop(principal: RequestPrincipal, stopId: string) {
    const stop = await this.access.requireStop(principal, stopId);
    const order = stop.orderId
      ? await this.prisma.order.findFirst({
          where: { id: stop.orderId, orgId: principal.orgId },
          include: { items: { include: { tag: true } }, account: { select: { id: true, name: true } }, site: { select: { id: true, name: true, address: true } } },
        })
      : null;

    const expectedItems = (order?.items ?? []).map((it) => ({ itemId: it.id, kind: it.kind, tagCode: it.tag?.code ?? null, status: it.status }));
    const lines = [
      {
        stopId: stop.id,
        seq: stop.seq,
        kind: stop.kind,
        orderId: stop.orderId,
        account: order?.account ?? null,
        site: order?.site ?? null,
        expectedItems,
        expectedItemCount: expectedItems.length,
      },
    ];

    const manifest = await this.prisma.manifest.create({
      data: { orgId: principal.orgId, routeStopId: stop.id, lines: lines as unknown as Prisma.InputJsonValue, createdBy: principal.userId },
    });
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Manifest', entityId: manifest.id, action: 'MANIFEST_GENERATED', after: { routeStopId: stop.id, expectedItemCount: expectedItems.length } });
    return manifest;
  }

  /** Generate (snapshot) the manifest for a whole route — all stops + their expected items. */
  async generateForRoute(principal: RequestPrincipal, routeId: string) {
    await this.access.requireRoute(principal, routeId);
    const stops = await this.prisma.routeStop.findMany({
      where: { routeId, orgId: principal.orgId },
      orderBy: { seq: 'asc' },
      include: { order: { include: { items: { include: { tag: true } } } } },
    });
    const lines = stops.map((s) => ({
      stopId: s.id,
      seq: s.seq,
      kind: s.kind,
      orderId: s.orderId,
      expectedItems: (s.order?.items ?? []).map((it) => ({ itemId: it.id, kind: it.kind, tagCode: it.tag?.code ?? null })),
      expectedItemCount: s.order?.items.length ?? 0,
    }));
    const manifest = await this.prisma.manifest.create({
      data: { orgId: principal.orgId, routeId, lines: lines as unknown as Prisma.InputJsonValue, createdBy: principal.userId },
    });
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Manifest', entityId: manifest.id, action: 'MANIFEST_GENERATED', after: { routeId, stopCount: stops.length } });
    return manifest;
  }

  /** Latest manifest for a stop (scoped). */
  async forStop(principal: RequestPrincipal, stopId: string) {
    await this.access.requireStop(principal, stopId);
    return this.prisma.manifest.findFirst({ where: { routeStopId: stopId, orgId: principal.orgId }, orderBy: { generatedAt: 'desc' } });
  }
}
