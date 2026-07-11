import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_CUSTOMER_ERRORS,
  CUSTOMER_360_BILLING_LIMIT,
  CUSTOMER_360_ORDER_LIMIT,
  RoleType,
  type Customer360View,
  type CustomerAccountRef,
  type CustomerAddressView,
  type CustomerListItem,
  type CustomerListResult,
  type CustomerOrderView,
  type ListCustomersQuery,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { AuditService } from '../orders/audit.service';
import { decimalMoney } from '../orders/money';
import { ServiceZonesService } from '../service-zones/service-zones.service';
import { maskPushToken } from './admin-policy';
import { bookedByCustomer, orderTotals, toNotificationView, toServiceability } from './admin-customers-policy';
import type { RequestPrincipal } from '../auth/rbac/types';

/**
 * Console customer-360 (Increment 27) — the read-only, OWNER/CSR-gated consolidated view of a residential
 * customer. Reuses the proven reads rather than duplicating them: `scopedPrisma` for the org boundary,
 * `ServiceZonesService.isServiceable` for coverage, `maskPushToken` for device tokens, `AuditService` for
 * the staff-accountability trail.
 *
 * Two structural facts the code has to respect, not paper over:
 *
 *  • **A customer is a `User` holding a `RESIDENTIAL_CUSTOMER` grant.** Anyone else — staff, an
 *    ACCOUNT_ADMIN, a user in another org — is a 404. This endpoint reads customer PII; it must not double
 *    as a way to read staff PII.
 *
 *  • **Orders/invoices/payments hang off the ACCOUNT, not the person** (`Order` has no `userId`). So they
 *    are fetched by the customer's account ids and reported as `account*`. Per-order attribution comes
 *    only from `Order.createdBy`, and is `null` where that column is unset — never a fabricated `false`.
 *
 * Chat is deliberately not aggregated here (staff-invisible by design; moderation is a separate decision).
 */
@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly serviceZones: ServiceZonesService,
  ) {}

  // ─────────────────────────── list + search ───────────────────────────

  async listCustomers(principal: RequestPrincipal, query: ListCustomersQuery): Promise<CustomerListResult> {
    const db = scopedPrisma(this.prisma, principal);
    const search = query.search?.trim();

    // `some` on the relation, not a join filter: a user qualifies if ANY grant is RESIDENTIAL_CUSTOMER.
    const where: Prisma.UserWhereInput = {
      roles: { some: { role: RoleType.RESIDENTIAL_CUSTOMER } },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { phone: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };

    const rows = await db.user.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
        roles: { where: { role: RoleType.RESIDENTIAL_CUSTOMER }, select: { scopeId: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    // One round-trip each for the whole page's accounts, rather than N+1 per customer.
    const accountIds = [...new Set(page.flatMap((u) => u.roles.map((r) => r.scopeId).filter((id): id is string => id !== null)))];
    const [accounts, orderStats, addressCounts] = await Promise.all([
      this.loadAccounts(principal.orgId, accountIds),
      this.orderStatsByAccount(principal.orgId, accountIds),
      this.activeAddressCountByAccount(principal.orgId, accountIds),
    ]);

    const customers: CustomerListItem[] = page.map((u) => {
      const ids = u.roles.map((r) => r.scopeId).filter((id): id is string => id !== null);
      const stats = ids.map((id) => orderStats.get(id)).filter((s): s is { count: number; last: Date | null } => s !== undefined);
      const lastAt = stats.reduce<Date | null>((acc, s) => (s.last && (!acc || s.last > acc) ? s.last : acc), null);
      return {
        userId: u.id,
        name: u.name,
        phone: u.phone,
        email: u.email,
        status: u.status as string,
        joinedAt: u.createdAt.toISOString(),
        accounts: ids.map((id) => accounts.get(id)).filter((a): a is CustomerAccountRef => a !== undefined),
        accountOrderCount: stats.reduce((n, s) => n + s.count, 0),
        lastAccountOrderAt: lastAt ? lastAt.toISOString() : null,
        savedAddressCount: ids.reduce((n, id) => n + (addressCounts.get(id) ?? 0), 0),
      };
    });

    const last = page[page.length - 1];
    return { customers, nextCursor: hasMore && last ? last.id : null, hasMore };
  }

  // ─────────────────────────── the 360 aggregate ───────────────────────────

  async getCustomer360(principal: RequestPrincipal, userId: string): Promise<Customer360View> {
    const db = scopedPrisma(this.prisma, principal);
    const user = await db.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
        authProviders: true,
        referralCode: true,
        referredByUserId: true,
        roles: { select: { role: true, scope: true, scopeId: true }, orderBy: { role: 'asc' } },
        devices: { orderBy: { createdAt: 'desc' }, select: { id: true, platform: true, pushToken: true, lastSeen: true, createdAt: true } },
        notificationPref: true,
        corporateMemberships: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, accountId: true, status: true, source: true, createdAt: true, account: { select: { name: true } } },
        },
      },
    });

    // A cross-org id resolves to null through the scoped client; a staff id resolves but holds no
    // RESIDENTIAL_CUSTOMER grant. Both answer 404 — this endpoint never exposes staff PII.
    const customerGrants = user?.roles.filter((r) => r.role === RoleType.RESIDENTIAL_CUSTOMER) ?? [];
    if (!user || customerGrants.length === 0) {
      throw new NotFoundException({ error: ADMIN_CUSTOMER_ERRORS.CUSTOMER_NOT_FOUND, message: `customer ${userId} not found` });
    }

    const accountIds = customerGrants.map((r) => r.scopeId).filter((id): id is string => id !== null);

    const [accountsById, sites, orders, orderCount, invoices, payments, referrer, referralsMadeCount] = await Promise.all([
      this.loadAccounts(principal.orgId, accountIds),
      this.loadAddresses(principal.orgId, accountIds),
      this.loadOrders(principal.orgId, accountIds, user.id),
      accountIds.length === 0 ? Promise.resolve(0) : this.prisma.order.count({ where: { orgId: principal.orgId, accountId: { in: accountIds } } }),
      this.loadInvoices(principal.orgId, accountIds),
      this.loadPayments(principal.orgId, accountIds),
      // [Inc-34] Who referred THIS customer (org-scoped) + how many joined via THEIR code.
      user.referredByUserId
        ? this.prisma.user.findFirst({ where: { id: user.referredByUserId, orgId: principal.orgId }, select: { id: true, name: true } })
        : Promise.resolve(null),
      this.prisma.user.count({ where: { orgId: principal.orgId, referredByUserId: user.id } }),
    ]);

    // Staff read a consumer's PII — record it. §8.7 accountability; the AuditLog is append-only.
    await this.audit.record({
      orgId: principal.orgId,
      actorId: principal.userId,
      entity: 'User',
      entityId: user.id,
      action: 'CUSTOMER_360_VIEWED',
      after: { accountIds, addressCount: sites.length, orderCount },
    });

    return {
      customer: {
        userId: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        status: user.status as string,
        joinedAt: user.createdAt.toISOString(),
        authProviders: user.authProviders,
        roles: user.roles.map((r) => ({ role: r.role as unknown as RoleType, scope: r.scope as string, scopeId: r.scopeId ?? null })),
      },
      referral: {
        code: user.referralCode,
        referredBy: referrer ? { userId: referrer.id, name: referrer.name } : null,
        referralsMadeCount,
      },
      accounts: accountIds.map((id) => accountsById.get(id)).filter((a): a is CustomerAccountRef => a !== undefined),
      addresses: sites,
      orders,
      accountOrderCount: orderCount,
      invoices,
      payments,
      devices: user.devices.map((d) => ({
        id: d.id,
        platform: d.platform as unknown as CustomerDevicePlatform,
        pushTokenMasked: maskPushToken(d.pushToken),
        lastSeen: d.lastSeen ? d.lastSeen.toISOString() : null,
        createdAt: d.createdAt.toISOString(),
      })),
      memberships: user.corporateMemberships.map((m) => ({
        id: m.id,
        accountId: m.accountId,
        accountName: m.account.name,
        status: m.status as string,
        source: m.source as string,
        createdAt: m.createdAt.toISOString(),
      })),
      notifications: toNotificationView(user.notificationPref),
    };
  }

  // ─────────────────────────── loaders ───────────────────────────

  private async loadAccounts(orgId: string, accountIds: string[]): Promise<Map<string, CustomerAccountRef>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.prisma.account.findMany({
      where: { orgId, id: { in: accountIds } },
      select: { id: true, name: true, type: true },
    });
    return new Map(rows.map((a) => [a.id, { id: a.id, name: a.name, type: a.type as unknown as CustomerAccountRef['type'] }]));
  }

  /** Order count + most-recent order date per account, in one grouped query (no N+1). */
  private async orderStatsByAccount(orgId: string, accountIds: string[]): Promise<Map<string, { count: number; last: Date | null }>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.prisma.order.groupBy({
      by: ['accountId'],
      where: { orgId, accountId: { in: accountIds } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    return new Map(rows.map((r) => [r.accountId, { count: r._count._all, last: r._max.createdAt }]));
  }

  /** ACTIVE saved addresses per account — a removed address is soft-deleted (Inc-26), not gone. */
  private async activeAddressCountByAccount(orgId: string, accountIds: string[]): Promise<Map<string, number>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.prisma.site.groupBy({
      by: ['accountId'],
      where: { orgId, accountId: { in: accountIds }, active: true },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.accountId, r._count._all]));
  }

  /**
   * The customer's saved addresses, each with its live coverage answer. `Site.geo` is a Prisma
   * `Unsupported` geography column, so the point comes back through a raw ST_X/ST_Y read (the as-built
   * pattern in `CatalogService.readSiteGeo`). A site with no point gets `serviceability: null` — there is
   * nothing to test, so nothing is claimed.
   */
  private async loadAddresses(orgId: string, accountIds: string[]): Promise<CustomerAddressView[]> {
    if (accountIds.length === 0) return [];
    const sites = await this.prisma.site.findMany({
      where: { orgId, accountId: { in: accountIds }, active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, accountId: true, name: true, address: true, unit: true, buzzer: true, notes: true, isDefault: true },
    });
    if (sites.length === 0) return [];

    const geoById = await this.readSiteGeo(sites.map((s) => s.id));
    return Promise.all(
      sites.map(async (s) => {
        const geo = geoById.get(s.id) ?? null;
        // Same PostGIS gate the booking path uses — never a second, drifting coverage implementation.
        const serviceability = geo ? toServiceability(await this.serviceZones.isServiceable(orgId, geo)) : null;
        return { ...s, geo, serviceability };
      }),
    );
  }

  private async readSiteGeo(siteIds: string[]): Promise<Map<string, { lng: number; lat: number }>> {
    const out = new Map<string, { lng: number; lat: number }>();
    if (siteIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; lat: number | null; lng: number | null }>>(Prisma.sql`
      SELECT id, ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng
      FROM "Site" WHERE geo IS NOT NULL AND id IN (${Prisma.join(siteIds.map((id) => Prisma.sql`${id}::uuid`))})`);
    for (const r of rows) {
      if (r.lat !== null && r.lng !== null) out.set(r.id, { lng: Number(r.lng), lat: Number(r.lat) });
    }
    return out;
  }

  private async loadOrders(orgId: string, accountIds: string[], userId: string): Promise<CustomerOrderView[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.prisma.order.findMany({
      where: { orgId, accountId: { in: accountIds } },
      orderBy: { createdAt: 'desc' },
      take: CUSTOMER_360_ORDER_LIMIT,
      select: { id: true, accountId: true, siteId: true, status: true, vertical: true, totals: true, createdAt: true, createdBy: true },
    });
    return rows.map((o) => {
      const { total, currency } = orderTotals(o.totals);
      return {
        id: o.id,
        accountId: o.accountId,
        siteId: o.siteId,
        status: o.status as string,
        vertical: o.vertical as string,
        total,
        currency,
        createdAt: o.createdAt.toISOString(),
        bookedByThisCustomer: bookedByCustomer(o.createdBy, userId),
      };
    });
  }

  private async loadInvoices(orgId: string, accountIds: string[]) {
    if (accountIds.length === 0) return [];
    const rows = await this.prisma.invoice.findMany({
      where: { orgId, accountId: { in: accountIds } },
      orderBy: { createdAt: 'desc' },
      take: CUSTOMER_360_BILLING_LIMIT,
      select: { id: true, number: true, status: true, total: true, currency: true, issuedAt: true, orderId: true },
    });
    return rows.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status as string,
      // `Decimal.toString()` drops the trailing zero ("158.20" → "158.2"), which renders as "$158.2".
      // Every Decimal(12,2) crossing the wire goes through `decimalMoney` (see orders/money.ts).
      total: decimalMoney(i.total),
      currency: i.currency,
      issuedAt: i.issuedAt ? i.issuedAt.toISOString() : null,
      orderId: i.orderId,
    }));
  }

  private async loadPayments(orgId: string, accountIds: string[]) {
    if (accountIds.length === 0) return [];
    const rows = await this.prisma.payment.findMany({
      where: { orgId, accountId: { in: accountIds } },
      orderBy: { createdAt: 'desc' },
      take: CUSTOMER_360_BILLING_LIMIT,
      select: { id: true, status: true, method: true, amount: true, currency: true, createdAt: true, orderId: true, invoiceId: true },
    });
    return rows.map((p) => ({
      id: p.id,
      status: p.status as string,
      method: p.method as string,
      amount: decimalMoney(p.amount),
      currency: p.currency,
      createdAt: p.createdAt.toISOString(),
      orderId: p.orderId,
      invoiceId: p.invoiceId,
    }));
  }

}

/** Local alias so the device mapper reads cleanly without importing the enum twice. */
type CustomerDevicePlatform = Customer360View['devices'][number]['platform'];
