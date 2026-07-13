import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HOME_RECENT_ORDER_LIMIT,
  type CreateHomeBlockDto,
  type HomeBlockAdminView,
  type HomeBlockView,
  type HomeCtaTarget,
  type HomeOrderView,
  type HomeView,
  type UpdateHomeBlockDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../orders/audit.service';
import { CreditsService } from '../credits/credits.service';
import { decimalMoney } from '../orders/money';
import type { RequestPrincipal } from '../auth/rbac/types';

/**
 * [Inc-37] The customer Home tab + its founder-authored content.
 *
 * Everything Home renders is LIVE: the announcement cards are `HomeBlock` rows the founder edits in the
 * console, the credit balance is the real ledger sum, the reward terms come from the founder's funded config,
 * and the orders are the customer's actual orders. The app hard-codes no copy and no numbers.
 *
 * ⚑ The honesty seam: a founder can write anything in a block's free text, but the app renders the REWARD
 * from `reward` (config-derived) and the BALANCE from the ledger — so a block can never conjure a reward that
 * does not exist. With no funded reward, `reward.enabled` is false and the app shows no reward claim at all.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────────── customer ───────────────────────────────

  async getHome(principal: RequestPrincipal): Promise<HomeView> {
    const orgId = principal.orgId;
    const accountIds = principal.accountIds;

    const [blocks, credits, reward, user, orders, orderCount] = await Promise.all([
      this.prisma.homeBlock.findMany({
        where: { orgId, active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.credits.ledgerFor(principal.userId, orgId),
      this.credits.rewardTerms(orgId),
      this.prisma.user.findFirst({
        where: { id: principal.userId, orgId },
        select: { name: true, email: true, phone: true, referralCode: true },
      }),
      accountIds.length === 0
        ? Promise.resolve([])
        : this.prisma.order.findMany({
            where: { orgId, accountId: { in: accountIds } },
            orderBy: { createdAt: 'desc' },
            take: HOME_RECENT_ORDER_LIMIT,
            select: { id: true, status: true, createdAt: true, totals: true, quotes: { orderBy: { createdAt: 'desc' }, take: 1, select: { total: true } } },
          }),
      accountIds.length === 0 ? Promise.resolve(0) : this.prisma.order.count({ where: { orgId, accountId: { in: accountIds } } }),
    ]);

    return {
      blocks: blocks.map((b) => this.toBlockView(b)),
      credits,
      reward,
      recentOrders: orders.map((o): HomeOrderView => {
        const totals = (o.totals ?? {}) as { total?: string; currency?: string; estimateRange?: { low?: string } };
        // The order's real price if it has one: the quote total, else the booked total, else the pre-intake
        // estimate's low bound. NEVER a made-up number — null when the order genuinely has no price yet.
        const total = o.quotes[0]?.total != null ? decimalMoney(o.quotes[0].total) : (totals.total ?? totals.estimateRange?.low ?? null);
        return {
          id: o.id,
          status: o.status as unknown as HomeOrderView['status'],
          createdAt: o.createdAt.toISOString(),
          total: total ?? null,
          currency: totals.currency ?? 'CAD',
        };
      }),
      orderCount,
      account: {
        name: user?.name ?? '',
        email: user?.email ?? null,
        phone: user?.phone ?? null,
        referralCode: user?.referralCode ?? null,
      },
    };
  }

  // ─────────────────────────────── console (OWNER) ───────────────────────────────

  /** Every block, active or not, in render order — the console's list. */
  async listBlocks(principal: RequestPrincipal): Promise<{ blocks: HomeBlockAdminView[] }> {
    const rows = await this.prisma.homeBlock.findMany({
      where: { orgId: principal.orgId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { blocks: rows.map((r) => this.toAdminView(r)) };
  }

  async createBlock(principal: RequestPrincipal, dto: CreateHomeBlockDto): Promise<HomeBlockAdminView> {
    const created = await this.prisma.homeBlock.create({
      data: {
        orgId: principal.orgId,
        title: dto.title,
        body: dto.body,
        ctaLabel: dto.ctaLabel ?? null,
        ctaTarget: dto.ctaTarget ?? null,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdBy: principal.userId,
      },
    });
    await this.audit.record({
      orgId: principal.orgId,
      actorId: principal.userId,
      entity: 'HomeBlock',
      entityId: created.id,
      action: 'HOME_BLOCK_CREATED',
      after: { title: created.title, active: created.active },
    });
    return this.toAdminView(created);
  }

  async updateBlock(principal: RequestPrincipal, id: string, dto: UpdateHomeBlockDto): Promise<HomeBlockAdminView> {
    const existing = await this.prisma.homeBlock.findFirst({ where: { id, orgId: principal.orgId } });
    if (!existing) throw new NotFoundException({ error: 'home_block_not_found', message: `Home block ${id} not found` });

    const updated = await this.prisma.homeBlock.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.ctaLabel !== undefined ? { ctaLabel: dto.ctaLabel } : {}),
        ...(dto.ctaTarget !== undefined ? { ctaTarget: dto.ctaTarget } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    await this.audit.record({
      orgId: principal.orgId,
      actorId: principal.userId,
      entity: 'HomeBlock',
      entityId: id,
      action: 'HOME_BLOCK_UPDATED',
      before: { title: existing.title, body: existing.body, active: existing.active },
      after: { title: updated.title, body: updated.body, active: updated.active },
    });
    return this.toAdminView(updated);
  }

  /** Hard-delete a block (it is pure content — nothing references it). */
  async deleteBlock(principal: RequestPrincipal, id: string): Promise<{ deleted: true; id: string }> {
    const existing = await this.prisma.homeBlock.findFirst({ where: { id, orgId: principal.orgId } });
    if (!existing) throw new NotFoundException({ error: 'home_block_not_found', message: `Home block ${id} not found` });
    await this.prisma.homeBlock.delete({ where: { id } });
    await this.audit.record({
      orgId: principal.orgId,
      actorId: principal.userId,
      entity: 'HomeBlock',
      entityId: id,
      action: 'HOME_BLOCK_DELETED',
      before: { title: existing.title },
    });
    return { deleted: true, id };
  }

  // ─────────────────────────────── mapping ───────────────────────────────

  private toBlockView(b: Prisma.HomeBlockGetPayload<object>): HomeBlockView {
    return {
      id: b.id,
      kind: b.kind,
      title: b.title,
      body: b.body,
      ctaLabel: b.ctaLabel,
      // A legacy/unknown target is dropped rather than shipped to the app, which could not route it anyway.
      ctaTarget: (b.ctaTarget as HomeCtaTarget | null) ?? null,
      sortOrder: b.sortOrder,
    };
  }

  private toAdminView(b: Prisma.HomeBlockGetPayload<object>): HomeBlockAdminView {
    return { ...this.toBlockView(b), active: b.active, updatedAt: b.updatedAt.toISOString() };
  }
}
