import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Order } from '@prisma/client';
import {
  CustodyStage,
  ItemStatus,
  OrderStatus,
  ORDER_ERRORS,
  PhotoKind,
  type InspectionDto,
  type ItemPhotoDto,
  type ReceivedAtPlantDto,
  type SchedulePickupDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from './audit.service';
import { MediaService } from './media';
import { OrderAccessService } from './order-access.service';
import { OrderStateMachine } from './state-machine.service';
import { OrdersService } from './orders.service';

/** Linear §5.1 pickup spine (no branches up to PICKED_UP). */
const RECEIVE_SPINE: OrderStatus[] = [
  OrderStatus.REQUESTED,
  OrderStatus.SCHEDULED_PICKUP,
  OrderStatus.PICKUP_EN_ROUTE,
  OrderStatus.PICKED_UP,
];

const INTAKE_WINDOW: OrderStatus[] = [
  OrderStatus.PICKED_UP,
  OrderStatus.INTAKE_INSPECTED,
  OrderStatus.DAMAGE_PREEXISTING_FLAGGED,
];

@Injectable()
export class IntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly stateMachine: OrderStateMachine,
    private readonly audit: AuditService,
    private readonly media: MediaService,
    private readonly orders: OrdersService,
  ) {}

  // ─────────────────────── schedule pickup (REQUESTED → SCHEDULED_PICKUP) ───────────────────────

  async schedulePickup(principal: RequestPrincipal, orderId: string, dto: SchedulePickupDto) {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    await this.prisma.$transaction(async (tx) => {
      await this.stateMachine.apply(tx, order, OrderStatus.SCHEDULED_PICKUP, { actorId: principal.userId });
      await tx.order.update({
        where: { id: orderId },
        data: { scheduledPickupWindow: dto.pickupWindow as unknown as Prisma.InputJsonValue },
      });
    });
    return this.orders.getOrder(principal, orderId);
  }

  // ─────────────────── received-at-plant (authorized walk to PICKED_UP, no driver) ───────────────────

  /**
   * Authorized CSR/OWNER "received at plant" — drives the order along the linear pickup
   * spine to PICKED_UP so intake can proceed WITHOUT fabricating a driver/GPS (the real
   * PICKUP_EN_ROUTE/PICKED_UP driver scans land in Increment 4). Each step is a legal,
   * atomic, audited §5.1 transition; on PICKED_UP every item gets a real PICKED_UP custody event.
   */
  async receivedAtPlant(principal: RequestPrincipal, orderId: string, dto: ReceivedAtPlantDto) {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    const startIdx = RECEIVE_SPINE.indexOf(order.status as unknown as OrderStatus);
    const targetIdx = RECEIVE_SPINE.indexOf(OrderStatus.PICKED_UP);
    if (startIdx === -1 || startIdx >= targetIdx) {
      throw new ConflictException({
        error: ORDER_ERRORS.ILLEGAL_TRANSITION,
        message: `received-at-plant requires the order to be before PICKED_UP (current: ${order.status})`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      let cur = order.status as unknown as OrderStatus;
      for (let i = startIdx; i < targetIdx; i++) {
        const next = RECEIVE_SPINE[i + 1];
        await this.stateMachine.apply(
          tx,
          { id: order.id, orgId: order.orgId, status: cur as unknown as Order['status'], heldFrom: order.heldFrom },
          next,
          { actorId: principal.userId, reason: dto.note ?? 'received at plant (manual receive)' },
        );
        cur = next;
      }
      // PICKED_UP: write a custody event per item (chain of custody is the product, §8.2).
      const items = await tx.item.findMany({ where: { orderId, orgId: order.orgId }, select: { id: true } });
      for (const it of items) {
        await tx.custodyEvent.create({
          data: {
            orgId: order.orgId,
            itemId: it.id,
            stage: CustodyStage.PICKED_UP,
            actorId: principal.userId,
            deviceId: 'plant-receive-station',
            createdBy: principal.userId,
          },
        });
      }
    });
    return this.orders.getOrder(principal, orderId);
  }

  // ─────────────────────── inspection (per item) ───────────────────────

  async inspect(principal: RequestPrincipal, orderId: string, itemId: string, dto: InspectionDto) {
    const { order, item } = await this.access.requireItemForWrite(principal, orderId, itemId);
    if (!INTAKE_WINDOW.includes(order.status as unknown as OrderStatus)) {
      throw new ConflictException({
        error: ORDER_ERRORS.ILLEGAL_TRANSITION,
        message: `Inspection requires the order at/after PICKED_UP and before QUOTED (current: ${order.status})`,
      });
    }
    const damageUrl = dto.preexistingDamage && dto.damagePhotoUrl ? this.media.requireValidUrl(dto.damagePhotoUrl) : null;

    await this.prisma.$transaction(async (tx) => {
      // Custody: arrival at intake station.
      await tx.custodyEvent.create({
        data: { orgId: order.orgId, itemId, stage: CustodyStage.INTAKE, actorId: principal.userId, deviceId: 'plant-intake-station', createdBy: principal.userId },
      });

      const ackAt = dto.preexistingDamage ? new Date() : null;
      const ackBy = dto.preexistingDamage ? (dto.ackBy ?? principal.userId) : null;
      const inspection = await tx.inspection.create({
        data: {
          orgId: order.orgId,
          itemId,
          conditionCodes: dto.conditionCodes,
          notes: dto.notes ?? null,
          preexistingDamage: dto.preexistingDamage,
          ackBy,
          ackAt,
          createdBy: principal.userId,
        },
      });

      // Persist the damage-evidence photo (real reference; intake kind).
      if (damageUrl) {
        await tx.photo.create({
          data: { orgId: order.orgId, itemId, orderId, kind: PhotoKind.INTAKE, url: damageUrl, createdBy: principal.userId },
        });
      }

      // Merge measured values into Item.measurements; mark the item inspected.
      const mergedMeasurements = { ...((item.measurements as Record<string, unknown>) ?? {}), ...dto.measurements };
      await tx.item.update({
        where: { id: itemId },
        data: { measurements: mergedMeasurements as Prisma.InputJsonValue, status: ItemStatus.INSPECTED },
      });

      // Custody: inspected.
      await tx.custodyEvent.create({
        data: { orgId: order.orgId, itemId, stage: CustodyStage.INSPECTED, actorId: principal.userId, deviceId: 'plant-intake-station', createdBy: principal.userId },
      });

      await this.audit.record(
        {
          orgId: order.orgId,
          actorId: principal.userId,
          entity: 'Inspection',
          entityId: inspection.id,
          action: 'INSPECTION_RECORDED',
          after: { itemId, conditionCodes: dto.conditionCodes, preexistingDamage: dto.preexistingDamage, ackBy, hasDamagePhoto: !!damageUrl },
        },
        tx,
      );

      // Order-level progression: when every item is inspected, advance PICKED_UP → INTAKE_INSPECTED,
      // then to DAMAGE_PREEXISTING_FLAGGED if any inspection flagged pre-existing damage (§5.1 branch).
      const remaining = await tx.item.count({ where: { orderId, orgId: order.orgId, status: { not: ItemStatus.INSPECTED } } });
      if (remaining === 0 && (order.status as unknown as OrderStatus) === OrderStatus.PICKED_UP) {
        await this.stateMachine.apply(
          tx,
          { id: order.id, orgId: order.orgId, status: order.status, heldFrom: order.heldFrom },
          OrderStatus.INTAKE_INSPECTED,
          { actorId: principal.userId },
        );
        const flagged = await tx.inspection.count({ where: { orgId: order.orgId, preexistingDamage: true, item: { orderId } } });
        if (flagged > 0) {
          await this.stateMachine.apply(
            tx,
            { id: order.id, orgId: order.orgId, status: OrderStatus.INTAKE_INSPECTED as unknown as Order['status'], heldFrom: order.heldFrom },
            OrderStatus.DAMAGE_PREEXISTING_FLAGGED,
            { actorId: principal.userId, reason: 'pre-existing damage flagged at intake (photo + customer ack)' },
          );
        }
      }
    });
    return this.orders.getOrder(principal, orderId);
  }

  // ─────────────────────── photos (per item) ───────────────────────

  async addPhoto(principal: RequestPrincipal, orderId: string, itemId: string, dto: ItemPhotoDto) {
    const { order } = await this.access.requireItemForWrite(principal, orderId, itemId);
    if (!INTAKE_WINDOW.includes(order.status as unknown as OrderStatus)) {
      throw new ConflictException({
        error: ORDER_ERRORS.ILLEGAL_TRANSITION,
        message: `Photos can be attached during intake (PICKED_UP…DAMAGE_PREEXISTING_FLAGGED); current: ${order.status}`,
      });
    }
    const url = this.media.requireValidUrl(dto.url);

    const photo = await this.prisma.$transaction(async (tx) => {
      const created = await tx.photo.create({
        data: {
          orgId: order.orgId,
          itemId,
          orderId,
          kind: dto.kind,
          url,
          ...(dto.takenAt ? { takenAt: new Date(dto.takenAt) } : {}),
          createdBy: principal.userId,
        },
      });
      if (dto.geo) {
        await tx.$executeRaw`
          UPDATE "Photo" SET geo = ST_SetSRID(ST_MakePoint(${dto.geo.lng}, ${dto.geo.lat}), 4326)::geography
          WHERE id = ${created.id}::uuid`;
      }
      await this.audit.record(
        { orgId: order.orgId, actorId: principal.userId, entity: 'Photo', entityId: created.id, action: 'PHOTO_ADDED', after: { itemId, kind: dto.kind, url } },
        tx,
      );
      return created;
    });
    return photo;
  }
}
