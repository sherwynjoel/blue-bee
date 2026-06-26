import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  createStandingOrderSchema,
  listStandingOrdersQuerySchema,
  runGenerationSchema,
  updateStandingOrderSchema,
  type CreateStandingOrderDto,
  type ListStandingOrdersQuery,
  type RunGenerationDto,
  type UpdateStandingOrderDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { StandingOrderService } from './standing-order.service';
import { StandingOrderGenerationService } from './standing-order-generation.service';

/**
 * Standing/recurring orders (Track A, PRD §9.2/§14). `/v1/standing-orders` — org-scoped, problem+json,
 * every mutation audited. RBAC (§17.3): create/update/delete/run are ops (OWNER/DISPATCHER); reads add
 * CSR. Non-ops roles (DRIVER, account/residential) → 403. The generation trigger (`run`) reuses the
 * Inc-8 background job pattern; the B2B console view that renders these is a post-merge follow-on.
 */
@ApiTags('standing-orders')
@ApiBearerAuth()
@Controller('standing-orders')
export class StandingOrdersController {
  static readonly OPS_WRITE = [RoleType.OWNER, RoleType.DISPATCHER];
  static readonly OPS_READ = [RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR];

  constructor(
    private readonly standingOrders: StandingOrderService,
    private readonly generation: StandingOrderGenerationService,
  ) {}

  @Post()
  @Roles(...StandingOrdersController.OPS_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a standing/recurring order (audited). Account+site+service must be in scope.' })
  create(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createStandingOrderSchema)) dto: CreateStandingOrderDto) {
    return this.standingOrders.create(p, dto);
  }

  @Post('run')
  @Roles(...StandingOrdersController.OPS_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run one generation pass for THIS org — materialize DUE standing orders into Orders + Routes (idempotent). Audited.' })
  run(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(runGenerationSchema)) dto: RunGenerationDto) {
    // orgId pins the pass to the caller's tenant — an ops user can never trigger another org's generation.
    return this.generation.generateDue({ asOf: dto.asOf ? new Date(dto.asOf) : undefined, standingOrderId: dto.standingOrderId, orgId: p.orgId });
  }

  @Get()
  @Roles(...StandingOrdersController.OPS_READ)
  @ApiOperation({ summary: 'List standing orders (org-scoped, cursor-paginated).' })
  list(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listStandingOrdersQuerySchema)) q: ListStandingOrdersQuery) {
    return this.standingOrders.list(p, q);
  }

  @Get(':id')
  @Roles(...StandingOrdersController.OPS_READ)
  @ApiOperation({ summary: 'Read one standing order (org-scoped; cross-org id → 404).' })
  get(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.standingOrders.get(p, id);
  }

  @Get(':id/occurrences')
  @Roles(...StandingOrdersController.OPS_READ)
  @ApiOperation({ summary: 'List the generated occurrences (orders + routes) for a standing order.' })
  occurrences(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.standingOrders.occurrences(p, id);
  }

  @Patch(':id')
  @Roles(...StandingOrdersController.OPS_WRITE)
  @ApiOperation({ summary: 'Update a standing order (cadence/window/active/concierge/endsOn) — audited.' })
  update(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(updateStandingOrderSchema)) dto: UpdateStandingOrderDto) {
    return this.standingOrders.update(p, id, dto);
  }

  @Delete(':id')
  @Roles(...StandingOrdersController.OPS_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a standing order (cascades its occurrence ledger; generated orders persist) — audited.' })
  remove(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.standingOrders.remove(p, id);
  }
}
