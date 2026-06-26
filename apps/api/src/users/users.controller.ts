import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type MeResponse } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PrincipalService } from '../auth/principal.service';
import { CurrentUser } from '../auth/rbac/decorators';
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
}
// `GET /admin/users` moved to AdminController (Increment 16 — the OWNER-gated admin surface).
