import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  listStopsQuerySchema,
  patchStopSchema,
  stopActionSchema,
  stopExceptionSchema,
  type ListStopsQuery,
  type PatchStopDto,
  type StopActionDto,
  type StopExceptionDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { RouteStopService } from './route-stop.service';
import { ManifestService } from './manifest.service';

/**
 * Route stops (PRD §5.4 stop state machine, §11.1 driver-stop verbs).
 * Transitions/PATCH are OWNER/DISPATCHER now and structured so DRIVER (own stops) slots in
 * with the driver app. GET endpoints are row-scoped: a customer reads only their own
 * account's stop status (the "track my truck" data), org staff read all.
 */
@ApiTags('route-stops')
@ApiBearerAuth()
@Controller('route-stops')
@UseInterceptors(IdempotencyInterceptor)
export class RouteStopsController {
  constructor(
    private readonly stops: RouteStopService,
    private readonly manifests: ManifestService,
  ) {}

  // ── reads (scoped: customers see only their own order's stops) ──
  @Get()
  @ApiOperation({ summary: 'List route stops (row-scoped; customers see only their own order’s stops).' })
  list(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listStopsQuerySchema)) q: ListStopsQuery) {
    return this.stops.list(p, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one stop’s status (scoped). The track-my-truck data source.' })
  get(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.stops.getStop(p, id);
  }

  @Get(':id/manifest')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  @ApiOperation({ summary: 'Latest manifest for a stop.' })
  getManifest(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.manifests.forStop(p, id);
  }

  @Post(':id/manifest')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a stop manifest (expected items for the pickup).' })
  generateManifest(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.manifests.generateForStop(p, id);
  }

  @Patch(':id')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @ApiOperation({ summary: 'Reassign a stop to another route/driver and/or resequence it (audited).' })
  patch(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(patchStopSchema)) dto: PatchStopDto) {
    return this.stops.patch(p, id, dto);
  }

  // ── §5.4 driver-stop verbs (OWNER/DISPATCHER now; DRIVER-ready) ──
  @Post(':id\\:depart')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PENDING → EN_ROUTE. For a pickup, drives the order SCHEDULED_PICKUP → PICKUP_EN_ROUTE.' })
  depart(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.stops.depart(p, id, dto);
  }

  @Post(':id\\:arrive')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'EN_ROUTE → ARRIVED.' })
  arrive(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.stops.arrive(p, id, dto);
  }

  @Post(':id\\:start')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ARRIVED → IN_PROGRESS.' })
  start(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.stops.start(p, id, dto);
  }

  @Post(':id\\:complete')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'IN_PROGRESS → COMPLETED. For a pickup, drives the order PICKUP_EN_ROUTE → PICKED_UP (+ custody).' })
  complete(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopActionSchema)) dto: StopActionDto) {
    return this.stops.complete(p, id, dto);
  }

  @Post(':id\\:fail')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fail a stop (requires a reason code).' })
  fail(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopExceptionSchema)) dto: StopExceptionDto) {
    return this.stops.fail(p, id, dto);
  }

  @Post(':id\\:skip')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Skip a stop (requires a reason code).' })
  skip(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(stopExceptionSchema)) dto: StopExceptionDto) {
    return this.stops.skip(p, id, dto);
  }
}
