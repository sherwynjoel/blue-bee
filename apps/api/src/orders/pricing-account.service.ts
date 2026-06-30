import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A geo point (matches the shared `GeoPoint`). */
export interface ServicePoint {
  lat: number;
  lng: number;
}

export interface ResolveEffectivePricingInput {
  orgId: string;
  /** The booking user — drives JOIN-CODE membership (the TTC path). */
  userId: string;
  /** The order's payer account (`Order.accountId`). The result is null when it would equal this. */
  payerAccountId: string;
  /** The pickup service point, when supplied — drives BUILDING match (the condo path). */
  serviceGeo?: ServicePoint;
}

/** Why an order is priced on a corporate account (audited on the order for transparency). */
export type EffectivePricingSource = 'building_match' | 'membership';

export interface EffectivePricingResult {
  pricingAccountId: string;
  source: EffectivePricingSource;
}

/**
 * Resolves the EFFECTIVE PRICING ACCOUNT for a booking (Inc-15). The order's `accountId` stays the payer;
 * this only decides whether the order is PRICED on a corporate account's rate card — it never moves the
 * §5.1 spine, the payer, or RBAC scope. Two engines, deterministic precedence:
 *
 *   1. BUILDING MATCH (condo path) — if the booking carries a service point and it falls inside a
 *      corporate building's boundary (`Site.geo` + `Site.matchRadiusM`, real PostGIS `ST_DWithin` on
 *      geography metres), price on that building's account. Ties broken by nearest centre (ST_Distance).
 *   2. MEMBERSHIP (TTC path) — else if the booking user holds an ACTIVE CorporateMembership on a
 *      corporate account, price on that account.
 *   3. Otherwise null ⇒ priced on the payer's own account (default/residential), cleanly.
 *
 * Building match wins because the physical service address is the most specific, member-independent
 * signal. Returns null when the resolved account would equal the payer (no self-referential override).
 */
@Injectable()
export class PricingAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForBooking(input: ResolveEffectivePricingInput): Promise<EffectivePricingResult | null> {
    const { orgId, userId, payerAccountId, serviceGeo } = input;

    // 1) Building match — the closest corporate building whose boundary contains the point.
    if (serviceGeo) {
      const matchedAccountId = await this.matchBuilding(orgId, serviceGeo);
      if (matchedAccountId && matchedAccountId !== payerAccountId) {
        return { pricingAccountId: matchedAccountId, source: 'building_match' };
      }
    }

    // 2) Membership — the booking user's most-recent ACTIVE corporate membership.
    const membership = await this.prisma.corporateMembership.findFirst({
      where: { orgId, userId, status: 'ACTIVE', account: { corporate: true } },
      orderBy: { createdAt: 'desc' },
      select: { accountId: true },
    });
    if (membership && membership.accountId !== payerAccountId) {
      return { pricingAccountId: membership.accountId, source: 'membership' };
    }

    return null;
  }

  /**
   * The nearest corporate building (Site under a `corporate` account, with a geo point + match radius)
   * whose boundary contains `point`. Real PostGIS on `geography(Point,4326)` — `ST_DWithin` in metres,
   * `ST_Distance` to disambiguate overlapping boundaries deterministically. Org-scoped.
   */
  private async matchBuilding(orgId: string, point: ServicePoint): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ account_id: string }>>(Prisma.sql`
      SELECT s."account_id"
      FROM "Site" s
      JOIN "Account" a ON a."id" = s."account_id"
      WHERE s."org_id" = ${orgId}::uuid
        AND a."corporate" = true
        AND s."match_radius_m" IS NOT NULL
        AND s."geo" IS NOT NULL
        AND ST_DWithin(
          s."geo",
          ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography,
          s."match_radius_m"
        )
      ORDER BY ST_Distance(
        s."geo",
        ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography
      ) ASC
      LIMIT 1
    `);
    return rows[0]?.account_id ?? null;
  }
}
