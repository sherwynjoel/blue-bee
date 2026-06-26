import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Order } from '@prisma/client';
import { OrderStatus, ORDER_ERRORS, canTransitionOrder } from '@blue-bee/shared';
import { AuditService } from './audit.service';

/**
 * The §5.1 specialty state machine, enforced server-side. The full graph lives in
 * `@blue-bee/shared` `canTransitionOrder` (all 22 states modeled); this service is
 * the transactional, audited, race-safe applier:
 *   • illegal transition  → 409 problem+json (rejected before any write)
 *   • the apply is an ATOMIC conditional update (WHERE status = from) so two concurrent
 *     transitions can't both win — the loser gets a 409 (e.g. double-approve).
 *   • ON_HOLD records `heldFrom` (the paused state); resume returns to it and clears it.
 *   • every applied transition writes an AuditLog (before/after).
 */
@Injectable()
export class OrderStateMachine {
  constructor(private readonly audit: AuditService) {}

  /** Throw 409 if `from → to` is not a legal §5.1 transition (respecting heldFrom on resume). */
  assertLegal(from: OrderStatus, to: OrderStatus, heldFrom?: OrderStatus | null): void {
    if (!canTransitionOrder(from, to, heldFrom ?? undefined)) {
      throw new ConflictException({
        error: ORDER_ERRORS.ILLEGAL_TRANSITION,
        message: `Illegal transition ${from} → ${to}${heldFrom ? ` (held from ${heldFrom})` : ''} per PRD §5.1`,
      });
    }
  }

  /**
   * Apply a single transition atomically inside a transaction. Validates legality,
   * then conditionally updates only if the row is still in `from` (race guard), and
   * writes the audit entry. Returns the new status. Throws 409 on illegal or on a lost race.
   */
  async apply(
    tx: Prisma.TransactionClient,
    order: Pick<Order, 'id' | 'orgId' | 'status' | 'heldFrom'>,
    to: OrderStatus,
    opts: { actorId: string | null; reason?: string; extraAudit?: Record<string, unknown> },
  ): Promise<OrderStatus> {
    const from = order.status as unknown as OrderStatus;
    const heldFrom = (order.heldFrom as unknown as OrderStatus | null) ?? null;
    this.assertLegal(from, to, heldFrom);

    // heldFrom bookkeeping: entering ON_HOLD records the paused state; leaving clears it.
    let nextHeldFrom: OrderStatus | null = heldFrom;
    if (to === OrderStatus.ON_HOLD) nextHeldFrom = from;
    else if (from === OrderStatus.ON_HOLD) nextHeldFrom = null;

    const res = await tx.order.updateMany({
      where: { id: order.id, orgId: order.orgId, status: from as unknown as Order['status'] },
      data: {
        status: to as unknown as Order['status'],
        heldFrom: nextHeldFrom as unknown as Order['heldFrom'],
      },
    });
    if (res.count !== 1) {
      // Someone else moved the order between our read and write — fail the race safely.
      throw new ConflictException({
        error: ORDER_ERRORS.ILLEGAL_TRANSITION,
        message: `Order ${order.id} was concurrently modified; transition ${from} → ${to} no longer valid`,
      });
    }

    await this.audit.record(
      {
        orgId: order.orgId,
        actorId: opts.actorId,
        entity: 'Order',
        entityId: order.id,
        action: 'STATUS_TRANSITION',
        before: { status: from, heldFrom },
        after: { status: to, heldFrom: nextHeldFrom, ...(opts.reason ? { reason: opts.reason } : {}), ...(opts.extraAudit ?? {}) },
      },
      tx,
    );
    return to;
  }
}
