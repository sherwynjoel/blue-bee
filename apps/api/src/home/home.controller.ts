import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  createHomeBlockSchema,
  updateHomeBlockSchema,
  type CreateHomeBlockDto,
  type HomeBlockAdminView,
  type HomeView,
  type UpdateHomeBlockDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { HomeService } from './home.service';

/**
 * [Inc-37] The customer Home tab — one aggregate read. Any authenticated user gets THEIR OWN home (blocks are
 * org-wide; credits/orders/account are self-scoped server-side), so there is no `@Roles` gate beyond auth.
 */
@ApiTags('home')
@ApiBearerAuth()
@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  @ApiOperation({
    summary:
      "The customer's Home: the founder's announcement blocks, their REAL credit balance + ledger, the live " +
      'referral reward terms (disabled ⇒ the app promises nothing), recent orders and account identity.',
  })
  getHome(@CurrentUser() principal: RequestPrincipal): Promise<HomeView> {
    return this.home.getHome(principal);
  }
}

/**
 * [Inc-37] The founder's Home content editor. OWNER only — this is the copy customers read, so it is not a
 * CSR-editable surface. Every write is audited.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(RoleType.OWNER)
@Controller('admin/home-blocks')
export class HomeAdminController {
  constructor(private readonly home: HomeService) {}

  @Get()
  @ApiOperation({ summary: "Every Home block (active or not), in render order — the console's editor list." })
  list(@CurrentUser() principal: RequestPrincipal): Promise<{ blocks: HomeBlockAdminView[] }> {
    return this.home.listBlocks(principal);
  }

  @Post()
  @ApiOperation({ summary: 'Create a Home announcement block. It appears in the app on the next Home refresh.' })
  create(
    @CurrentUser() principal: RequestPrincipal,
    @Body(new ZodBody(createHomeBlockSchema)) dto: CreateHomeBlockDto,
  ): Promise<HomeBlockAdminView> {
    return this.home.createBlock(principal, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a Home block (copy, CTA, order, or active). Reaches the app on the next refresh.' })
  update(
    @CurrentUser() principal: RequestPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBody(updateHomeBlockSchema)) dto: UpdateHomeBlockDto,
  ): Promise<HomeBlockAdminView> {
    return this.home.updateBlock(principal, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a Home block.' })
  remove(@CurrentUser() principal: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.home.deleteBlock(principal, id);
  }
}
