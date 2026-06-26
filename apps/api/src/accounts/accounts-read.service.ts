import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ACCOUNTS_ERRORS,
  type AccountDetailView,
  type AccountListItemView,
  type AccountListResult,
  type AccountType,
  type BillingMode,
  type ListAccountsQuery,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';

/**
 * Account directory reads (Track-A B2B account console) — thin, READ-ONLY, RBAC-gated, org-scoped.
 * Powers the console's account list + detail header; the per-account writes (billing terms, batch
 * invoice) + standing-order CRUD already exist (recurring module) and are reused by the UI. No schema
 * change, no writes (so nothing audited here). Counts are computed in the SAME query via Prisma
 * `_count` (incl. a filtered relation count for active standing orders) — no N+1.
 */
@Injectable()
export class AccountsReadService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: RequestPrincipal, query: ListAccountsQuery): Promise<AccountListResult> {
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.account.findMany({
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        type: true,
        billingMode: true,
        billingNetDays: true,
        // One query: total sites + the ACTIVE standing-order count (filtered relation count).
        _count: { select: { sites: true, standingOrders: { where: { active: true } } } },
      },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      accounts: page.map((a) => this.toItem(a)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    };
  }

  async get(principal: RequestPrincipal, accountId: string): Promise<AccountDetailView> {
    const db = scopedPrisma(this.prisma, principal);
    // findFirst (not findUnique) so the non-unique org scope merges cleanly → a cross-org id → 404.
    const a = await db.account.findFirst({
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        type: true,
        billingMode: true,
        billingNetDays: true,
        createdAt: true,
        sites: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
        // Site + ACTIVE standing-order count in the SAME query (filtered relation count — no N+1).
        _count: { select: { sites: true, standingOrders: { where: { active: true } } } },
      },
    });
    if (!a) {
      throw new NotFoundException({ error: ACCOUNTS_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });
    }
    return {
      id: a.id,
      name: a.name,
      type: a.type as AccountType,
      billingMode: a.billingMode as BillingMode,
      billingNetDays: a.billingNetDays,
      siteCount: a._count.sites,
      activeStandingOrderCount: a._count.standingOrders,
      createdAt: a.createdAt.toISOString(),
      sites: a.sites.map((s) => ({ id: s.id, name: s.name })),
    };
  }

  private toItem(a: {
    id: string;
    name: string;
    type: string;
    billingMode: string;
    billingNetDays: number;
    _count: { sites: number; standingOrders: number };
  }): AccountListItemView {
    return {
      id: a.id,
      name: a.name,
      type: a.type as AccountType,
      billingMode: a.billingMode as BillingMode,
      billingNetDays: a.billingNetDays,
      siteCount: a._count.sites,
      activeStandingOrderCount: a._count.standingOrders, // the filtered (active) count
    };
  }
}
