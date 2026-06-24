import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  addStopSchema,
  assignRouteSchema,
  createRouteSchema,
  listRoutesQuerySchema,
  optimizeRouteSchema,
  publishRouteSchema,
  type AddStopDto,
  type AssignRouteDto,
  type CreateRouteDto,
  type ListRoutesQuery,
  type OptimizeRouteDto,
  type PublishRouteDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { RouteService } from './route.service';
import { ManifestService } from './manifest.service';

/** Routes & dispatch (PRD §11.1 DISPATCH, §17.3 — build/assign/publish = OWNER/DISPATCHER; CSR may view). */
@ApiTags('routes')
@ApiBearerAuth()
@Controller('routes')
@UseInterceptors(IdempotencyInterceptor)
export class RoutesController {
  constructor(
    private readonly routes: RouteService,
    private readonly manifests: ManifestService,
  ) {}

  @Post()
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a route (PLANNED) with an optional depot/start point.' })
  create(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createRouteSchema)) dto: CreateRouteDto) {
    return this.routes.create(p, dto);
  }

  @Get()
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  @ApiOperation({ summary: 'List routes (row-scoped, cursor pagination).' })
  list(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listRoutesQuerySchema)) q: ListRoutesQuery) {
    return this.routes.list(p, q);
  }

  @Get(':id')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  @ApiOperation({ summary: 'Read a route with its ordered stops, driver and vehicle.' })
  get(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.routes.get(p, id);
  }

  @Post(':id/stops')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a stop tied to a specialty order (pickup precedes quote in §5.1).' })
  addStop(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(addStopSchema)) dto: AddStopDto) {
    return this.routes.addStop(p, id, dto);
  }

  @Post(':id/assign')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a driver and/or vehicle to the route.' })
  assign(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(assignRouteSchema)) dto: AssignRouteDto) {
    return this.routes.assign(p, id, dto);
  }

  @Post(':id/optimize')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sequence stops by in-house PostGIS nearest-neighbour respecting time windows (PLANNED only).' })
  optimize(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(optimizeRouteSchema)) dto: OptimizeRouteDto) {
    return this.routes.optimize(p, id, dto);
  }

  @Post(':id/publish')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a route (PLANNED → PUBLISHED); schedules each pickup order (REQUESTED → SCHEDULED_PICKUP).' })
  publish(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(publishRouteSchema)) dto: PublishRouteDto) {
    return this.routes.publish(p, id, dto);
  }

  @Post(':id/manifest')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a route manifest (expected items/orders per stop).' })
  routeManifest(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.manifests.generateForRoute(p, id);
  }
}
