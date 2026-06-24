import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { RoleScope, RoleType, type Principal, type RoleGrant } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Builds a principal's role grants + account/site scope from the DB (used at login). */
@Injectable()
export class PrincipalService {
  constructor(private readonly prisma: PrismaService) {}

  async loadGrants(userId: string): Promise<RoleGrant[]> {
    const roles = await this.prisma.userRole.findMany({ where: { userId } });
    // Prisma generates its own nominal enums; values are identical to the shared
    // enums (verified 1:1), so map across the boundary here.
    return roles.map((r) => ({
      role: r.role as unknown as RoleType,
      scope: r.scope as unknown as RoleScope,
      scopeId: r.scopeId ?? null,
    }));
  }

  /** account_id / site_id confinement derived from ACCOUNT/SITE-scoped grants (§17.3). */
  async deriveScope(grants: RoleGrant[]): Promise<{ accountIds: string[]; siteIds: string[] }> {
    const accountIds = new Set<string>();
    const siteIds = new Set<string>();
    for (const g of grants) {
      if (g.scope === RoleScope.ACCOUNT && g.scopeId) accountIds.add(g.scopeId);
      if (g.scope === RoleScope.SITE && g.scopeId) siteIds.add(g.scopeId);
    }
    if (siteIds.size > 0) {
      const sites = await this.prisma.site.findMany({
        where: { id: { in: [...siteIds] } },
        select: { accountId: true },
      });
      sites.forEach((s) => accountIds.add(s.accountId));
    }
    return { accountIds: [...accountIds], siteIds: [...siteIds] };
  }

  async buildPrincipal(user: User): Promise<Principal> {
    const roles = await this.loadGrants(user.id);
    const scope = await this.deriveScope(roles);
    return {
      userId: user.id,
      orgId: user.orgId,
      name: user.name,
      phone: user.phone ?? null,
      email: user.email ?? null,
      roles,
      accountIds: scope.accountIds,
      siteIds: scope.siteIds,
    };
  }
}
