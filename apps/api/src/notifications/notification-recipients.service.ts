import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A resolved owning-customer recipient (the columns the engine needs to address + render). */
export interface RecipientUser {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Recipient resolution (Increment 8, §8.5/§12.2) — the INVERSE of the Increment-6 read scope: given
 * a domain event on an order, who is its owning customer? A user is an owning customer of an order
 * iff they hold a CUSTOMER-role grant scoped to the order's account (or its site). Server-internal
 * (no request principal), so every query carries an EXPLICIT org_id — and the account/site predicate
 * guarantees we NEVER resolve a user outside the order's account or another org.
 */
@Injectable()
export class NotificationRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Owning-customer users for an order — account-scoped (or site-scoped) RESIDENTIAL_CUSTOMER /
   * ACCOUNT_ADMIN / ACCOUNT_STAFF grants, ACTIVE users only. Mirrors `buildReadScope` (scoped-prisma):
   * a confined customer is account/site-bound, so only same-account customers are returned.
   */
  async resolveOrderRecipients(orgId: string, orderId: string): Promise<RecipientUser[]> {
    return this.prisma.$queryRaw<RecipientUser[]>(Prisma.sql`
      SELECT DISTINCT u.id::text AS "userId", u.name AS "name", u.email AS "email", u.phone AS "phone"
      FROM "Order" o
      JOIN "UserRole" ur ON ur.org_id = o.org_id
        AND ur.role IN ('RESIDENTIAL_CUSTOMER', 'ACCOUNT_ADMIN', 'ACCOUNT_STAFF')
        AND (
          (ur.scope = 'ACCOUNT' AND ur.scope_id = o.account_id)
          OR (ur.scope = 'SITE' AND o.site_id IS NOT NULL AND ur.scope_id = o.site_id)
        )
      JOIN "User" u ON u.id = ur.user_id AND u.status = 'ACTIVE'
      WHERE o.id = ${orderId}::uuid AND o.org_id = ${orgId}::uuid
    `);
  }

  /**
   * Account-scoped customer recipients (Track A — the B2B self-serve invoice-portal receipt). The
   * owning account users of an invoice that has no order: ACCOUNT_ADMIN / ACCOUNT_STAFF /
   * RESIDENTIAL_CUSTOMER grants scoped to the account (or one of its sites), ACTIVE users only. Mirrors
   * `buildReadScope` — server-internal, so the query carries an EXPLICIT org_id and the account/site
   * predicate guarantees we never resolve a user outside the account or another org.
   */
  async resolveAccountRecipients(orgId: string, accountId: string): Promise<RecipientUser[]> {
    return this.prisma.$queryRaw<RecipientUser[]>(Prisma.sql`
      SELECT DISTINCT u.id::text AS "userId", u.name AS "name", u.email AS "email", u.phone AS "phone"
      FROM "UserRole" ur
      JOIN "User" u ON u.id = ur.user_id AND u.status = 'ACTIVE'
      LEFT JOIN "Site" s ON s.id = ur.scope_id AND s.org_id = ur.org_id
      WHERE ur.org_id = ${orgId}::uuid
        AND ur.role IN ('RESIDENTIAL_CUSTOMER', 'ACCOUNT_ADMIN', 'ACCOUNT_STAFF')
        AND (
          (ur.scope = 'ACCOUNT' AND ur.scope_id = ${accountId}::uuid)
          OR (ur.scope = 'SITE' AND s.account_id = ${accountId}::uuid)
        )
    `);
  }

  /**
   * Org-staff recipients for an internal alert (Increment 12 — dispute alerts go to owner/finance,
   * §17.3). ORG-scoped OWNER/FINANCE grants, ACTIVE users only. Server-internal, so the query
   * carries an EXPLICIT org_id and never resolves a user outside the org.
   */
  async resolveOrgStaffRecipients(orgId: string): Promise<RecipientUser[]> {
    return this.prisma.$queryRaw<RecipientUser[]>(Prisma.sql`
      SELECT DISTINCT u.id::text AS "userId", u.name AS "name", u.email AS "email", u.phone AS "phone"
      FROM "UserRole" ur
      JOIN "User" u ON u.id = ur.user_id AND u.status = 'ACTIVE'
      WHERE ur.org_id = ${orgId}::uuid
        AND ur.role IN ('OWNER', 'FINANCE')
        AND ur.scope = 'ORG'
    `);
  }

  /** ACTIVE push tokens for a user (explicit org). The PUSH channel's destination addresses. */
  async activePushTokens(orgId: string, userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ token: string }[]>(Prisma.sql`
      SELECT token FROM "DeviceToken"
      WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND active = true
    `);
    return rows.map((r) => r.token);
  }

  /** The driver's display name for the stop's route (template polish), or null when unassigned. */
  async driverNameForStop(orgId: string, stopId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ name: string | null }[]>(Prisma.sql`
      SELECT du.name AS "name"
      FROM "RouteStop" rs
      JOIN "Route" r ON r.id = rs.route_id
      LEFT JOIN "Driver" d ON d.id = r.driver_id
      LEFT JOIN "User" du ON du.id = d.user_id
      WHERE rs.id = ${stopId}::uuid AND rs.org_id = ${orgId}::uuid
      LIMIT 1
    `);
    return rows[0]?.name ?? null;
  }
}
