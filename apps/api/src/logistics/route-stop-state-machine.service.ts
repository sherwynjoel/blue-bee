import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RouteStop } from '@prisma/client';
import { LOGISTICS_ERRORS, RouteStopStatus, canTransitionStop } from '@blue-bee/shared';
import { AuditService } from '../orders/audit.service';

/** Terminal transitions that must carry a reason code (PRD §5.4/§6.3 exceptions). */
const REASON_REQUIRED = new Set<RouteStopStatus>([RouteStopStatus.FAILED, RouteStopStatus.SKIPPED]);

/**
 * The §5.4 RouteStop state machine, enforced server-side. The legal graph lives in
 * `@blue-bee/shared canTransitionStop`; this service is the transactional, audited,
 * race-safe applier (same pattern as OrderStateMachine):
 *   • illegal transition → 409 problem+json
 *   • apply is an ATOMIC conditional update (WHERE status = from) — concurrent
 *     transitions can't both win (loser → 409)
 *   • FAILED/SKIPPED require a reason code (else 400) — persisted on exceptionReason
 *   • arrivedAt/completedAt timestamps stamped on ARRIVED/COMPLETED
 *   • every applied transition writes an AuditLog
 */
@Injectable()
export class RouteStopStateMachine {
  constructor(private readonly audit: AuditService) {}

  assertLegal(from: RouteStopStatus, to: RouteStopStatus): void {
    if (!canTransitionStop(from, to)) {
      throw new ConflictException({
        error: LOGISTICS_ERRORS.ILLEGAL_STOP_TRANSITION,
        message: `Illegal stop transition ${from} → ${to} per PRD §5.4`,
      });
    }
  }

  async apply(
    tx: Prisma.TransactionClient,
    stop: Pick<RouteStop, 'id' | 'orgId' | 'status'>,
    to: RouteStopStatus,
    opts: { actorId: string; reason?: string; note?: string },
  ): Promise<RouteStopStatus> {
    const from = stop.status as unknown as RouteStopStatus;
    this.assertLegal(from, to);

    if (REASON_REQUIRED.has(to) && (!opts.reason || opts.reason.trim().length < 2)) {
      throw new BadRequestException({
        error: LOGISTICS_ERRORS.REASON_REQUIRED,
        message: `A reason code is required to ${to === RouteStopStatus.FAILED ? 'fail' : 'skip'} a stop`,
      });
    }

    const data: Prisma.RouteStopUpdateManyMutationInput = { status: to as unknown as RouteStop['status'] };
    if (to === RouteStopStatus.ARRIVED) data.arrivedAt = new Date();
    if (to === RouteStopStatus.COMPLETED) data.completedAt = new Date();
    if (REASON_REQUIRED.has(to)) data.exceptionReason = opts.reason ?? null;

    const res = await tx.routeStop.updateMany({
      where: { id: stop.id, orgId: stop.orgId, status: from as unknown as RouteStop['status'] },
      data,
    });
    if (res.count !== 1) {
      throw new ConflictException({
        error: LOGISTICS_ERRORS.ILLEGAL_STOP_TRANSITION,
        message: `Stop ${stop.id} was concurrently modified; transition ${from} → ${to} no longer valid`,
      });
    }

    await this.audit.record(
      {
        orgId: stop.orgId,
        actorId: opts.actorId,
        entity: 'RouteStop',
        entityId: stop.id,
        action: 'STOP_TRANSITION',
        before: { status: from },
        after: { status: to, ...(opts.reason ? { reason: opts.reason } : {}), ...(opts.note ? { note: opts.note } : {}) },
      },
      tx,
    );
    return to;
  }
}
