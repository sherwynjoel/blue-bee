import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ACCOUNTS_ERRORS,
  OrderStatus,
  PaymentStatus,
  type AccountManifestView,
  type AccountManifestsResult,
  type ListOrdersQuery,
  type OwnerExceptionsResult,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';
import { OrdersService } from '../orders/orders.service';
import {
  EXCEPTION_FEED_LIMIT,
  EXCEPTION_LOOKBACK_MS,
  EXCEPTION_STOP_STATUSES,
  OPEN_DISPUTE_STATUSES,
  normalizeExceptions,
} from '../common/exceptions-feed';

/** Cap the account manifests list (newest snapshots first). */
const MANIFEST_LIMIT = 100;

/**
 * Account portal reads (Track-A B2B account console — the Orders / Manifests / Exceptions tabs). Thin,
 * READ-ONLY, RBAC-gated, org-scoped, NOT audited, NO schema change. Every read first proves the account
 * is in the principal's scope (a cross-org id → 404), then confines the query to that ONE account:
 *   • Orders — DELEGATES to the proven `OrdersService.listOrders` with the additive `accountId` filter
 *     (no duplicated listing logic);
 *   • Manifests — a VIEW of already-generated route-stop manifests for the account (generation stays on
 *     the route/stop endpoints; this never creates one);
 *   • Exceptions — the owner exceptions feed (failed/skipped stops, held orders, open disputes, failed
 *     payments) account-scoped, reusing the SHARED status sets + `OwnerException` shape (exceptions-feed).
 */
@Injectable()
export class AccountsPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  /** Account's orders — delegate to the proven cursor-paginated listing, confined to this account. */
  async listOrders(principal: RequestPrincipal, accountId: string, query: ListOrdersQuery) {
    await this.assertAccountInScope(principal, accountId);
    // The path param is authoritative — override any query accountId so it can't be widened/smuggled.
    return this.ordersService.listOrders(principal, { ...query, accountId });
  }

  /** Account's recent route-stop manifests (one query; the join is index-backed — no N+1). */
  async manifests(principal: RequestPrincipal, accountId: string): Promise<AccountManifestsResult> {
    await this.assertAccountInScope(principal, accountId);
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.manifest.findMany({
      // Stop-level manifests whose stop belongs to this account (RouteStop.accountId is set at build
      // time — route.service.ts/recurring). Org-scope is pinned by scopedPrisma; this narrows to the account.
      where: { routeStopId: { not: null }, routeStop: { accountId } },
      orderBy: { generatedAt: 'desc' },
      take: MANIFEST_LIMIT,
      select: {
        id: true,
        generatedAt: true,
        routeId: true,
        routeStopId: true,
        lines: true,
        routeStop: {
          select: { routeId: true, seq: true, status: true, kind: true, orderId: true, site: { select: { name: true } } },
        },
      },
    });
    return { manifests: rows.map((m) => this.toManifestView(m)) };
  }

  /** Account-scoped exceptions feed — same status sets + shape as the owner cockpit, confined here. */
  async exceptions(principal: RequestPrincipal, accountId: string): Promise<OwnerExceptionsResult> {
    await this.assertAccountInScope(principal, accountId);
    const db = scopedPrisma(this.prisma, principal);
    const since = new Date(Date.now() - EXCEPTION_LOOKBACK_MS);

    const [stops, held, disputes, payments] = await Promise.all([
      // Stops link to the account directly (accountId) or via their order — match either; never leak.
      db.routeStop.findMany({
        where: { status: { in: EXCEPTION_STOP_STATUSES }, updatedAt: { gte: since }, OR: [{ accountId }, { order: { accountId } }] },
        orderBy: { updatedAt: 'desc' },
        take: EXCEPTION_FEED_LIMIT,
        select: { id: true, status: true, exceptionReason: true, updatedAt: true, routeId: true, orderId: true, site: { select: { name: true } } },
      }),
      db.order.findMany({
        where: { status: OrderStatus.ON_HOLD, accountId },
        orderBy: { updatedAt: 'desc' },
        take: EXCEPTION_FEED_LIMIT,
        select: { id: true, heldFrom: true, updatedAt: true, account: { select: { name: true } } },
      }),
      // Dispute has no order relation in the schema — attribute it to the account via its payment
      // (payment.accountId / payment.order.accountId). A dispute with no account-bearing payment is
      // safely excluded (better to under-include than leak another account's dispute).
      db.dispute.findMany({
        where: { status: { in: OPEN_DISPUTE_STATUSES }, payment: { OR: [{ accountId }, { order: { accountId } }] } },
        orderBy: { openedAt: 'desc' },
        take: EXCEPTION_FEED_LIMIT,
        select: { id: true, status: true, amount: true, currency: true, reason: true, openedAt: true, orderId: true },
      }),
      db.payment.findMany({
        where: { status: PaymentStatus.FAILED, updatedAt: { gte: since }, OR: [{ accountId }, { order: { accountId } }] },
        orderBy: { updatedAt: 'desc' },
        take: EXCEPTION_FEED_LIMIT,
        select: { id: true, amount: true, currency: true, lastError: true, orderId: true, updatedAt: true },
      }),
    ]);

    return { exceptions: normalizeExceptions({ stops, held, disputes, payments }) };
  }

  /** Prove the account exists in the principal's org (else 404) — the cross-org guard for every tab. */
  private async assertAccountInScope(principal: RequestPrincipal, accountId: string): Promise<void> {
    const db = scopedPrisma(this.prisma, principal);
    const acc = await db.account.findFirst({ where: { id: accountId }, select: { id: true } });
    if (!acc) {
      throw new NotFoundException({ error: ACCOUNTS_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });
    }
  }

  private toManifestView(m: {
    id: string;
    generatedAt: Date;
    routeId: string | null;
    routeStopId: string | null;
    lines: unknown;
    routeStop: { routeId: string; seq: number; status: string; kind: string; orderId: string | null; site: { name: string } | null } | null;
  }): AccountManifestView {
    const lines = Array.isArray(m.lines) ? m.lines : [];
    const expectedItemCount = lines.reduce((sum: number, l) => {
      const c = (l as { expectedItemCount?: unknown }).expectedItemCount;
      return sum + (typeof c === 'number' ? c : 0);
    }, 0);
    return {
      id: m.id,
      generatedAt: m.generatedAt.toISOString(),
      // A stop-level manifest carries no routeId of its own → fall back to its stop's route.
      routeId: m.routeId ?? m.routeStop?.routeId ?? null,
      routeStopId: m.routeStopId,
      stopSeq: m.routeStop?.seq ?? null,
      stopStatus: m.routeStop?.status ?? null,
      stopKind: m.routeStop?.kind ?? null,
      orderId: m.routeStop?.orderId ?? null,
      siteName: m.routeStop?.site?.name ?? null,
      expectedItemCount,
    };
  }
}
