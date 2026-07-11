import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@blue-bee/shared';
import type { RecordQcDto, RewashDto, SendToQcDto, StartCleaningDto } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { OrderAccessService } from './order-access.service';
import { OrderStateMachine } from './state-machine.service';
import { OrdersService } from './orders.service';

/**
 * [Inc-30] Production advance — the plant half of the §5.1 spine that shipped as dead enum: no service
 * ever moved an order past QUOTE_APPROVED. This wires the transitions the lifecycle already permits
 * (`SPECIALTY_ORDER_TRANSITIONS`, lifecycle.ts):
 *
 *   QUOTE_APPROVED → IN_CLEANING → QC → READY          (the mandatory happy path)
 *   QC → REWASH   /   IN_CLEANING → REWASH → IN_CLEANING (the rewash branch — QC failures made real)
 *
 * Every step is a human-triggered, atomic, audited `OrderStateMachine.apply` inside a `$transaction`.
 * No timers, no auto-advance — the plant/console drives each step (there is no driver action for plant
 * work). Legality is enforced by the state machine (illegal current-state → 409); org/account scope by
 * `requireOrderForWrite` (cross-org → 404, cross-account → 403). READY is then schedulable for delivery
 * (Inc-31). Nothing here touches `Item.status` — the per-item cleaning/QC denormalization is out of scope
 * for this increment (Inc-31 sets `Item.status = DELIVERED` on delivery).
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly stateMachine: OrderStateMachine,
    private readonly orders: OrdersService,
  ) {}

  /** Start (from QUOTE_APPROVED) or restart (from REWASH) cleaning → IN_CLEANING. */
  async startCleaning(principal: RequestPrincipal, orderId: string, dto: StartCleaningDto) {
    return this.advance(principal, orderId, OrderStatus.IN_CLEANING, dto.note ?? 'cleaning started');
  }

  /** IN_CLEANING → QC. */
  async sendToQc(principal: RequestPrincipal, orderId: string, dto: SendToQcDto) {
    return this.advance(principal, orderId, OrderStatus.QC, dto.note ?? 'sent to QC');
  }

  /** Record the QC decision: pass → QC → READY, fail → QC → REWASH (reason audited). */
  async recordQc(principal: RequestPrincipal, orderId: string, dto: RecordQcDto) {
    const to = dto.result === 'pass' ? OrderStatus.READY : OrderStatus.REWASH;
    const reason = dto.result === 'pass' ? (dto.reason ?? 'QC passed') : `QC failed → rewash: ${dto.reason}`;
    return this.advance(principal, orderId, to, reason);
  }

  /** Pull a load back for a rewash cycle mid-cleaning → IN_CLEANING → REWASH. */
  async rewash(principal: RequestPrincipal, orderId: string, dto: RewashDto) {
    return this.advance(principal, orderId, OrderStatus.REWASH, `rewash: ${dto.reason}`);
  }

  /**
   * Shared applier: resolve + scope the parent order (404/403), apply ONE audited §5.1 transition
   * atomically (illegal current-state or a lost race → 409, thrown by the state machine), then return
   * the fresh scoped order view. Mirrors `IntakeService.schedulePickup`.
   */
  private async advance(principal: RequestPrincipal, orderId: string, to: OrderStatus, reason: string) {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    await this.prisma.$transaction(async (tx) => {
      await this.stateMachine.apply(tx, order, to, { actorId: principal.userId, reason });
    });
    return this.orders.getOrder(principal, orderId);
  }
}
