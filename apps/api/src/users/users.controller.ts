import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType, type MeResponse } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PrincipalService } from '../auth/principal.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly principals: PrincipalService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'The authenticated principal — user, org, roles, scopes (PRD §11.1).' })
  async me(@CurrentUser() principal: RequestPrincipal): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: principal.orgId } });
    return { user: await this.principals.buildPrincipal(user), org: { id: org.id, name: org.name } };
  }

  @Get('admin/users')
  @Roles(RoleType.OWNER)
  @ApiOperation({ summary: 'List org users (OWNER only — §17.3 admin row). Org-scoped via the scoped client.' })
  async listUsers(@CurrentUser() principal: RequestPrincipal) {
    // Read through the scoping layer — automatically confined to the principal's org.
    const db = scopedPrisma(this.prisma, principal);
    const users = await db.user.findMany({
      select: { id: true, name: true, phone: true, email: true, status: true },
      orderBy: { name: 'asc' },
    });
    return { users, count: users.length };
  }
}
