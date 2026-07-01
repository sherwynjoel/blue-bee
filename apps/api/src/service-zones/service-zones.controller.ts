import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  createServiceZoneSchema,
  updateServiceZoneSchema,
  type CreateServiceZoneDto,
  type UpdateServiceZoneDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { ServiceZonesService } from './service-zones.service';

/**
 * Owner-drawn service zones (Increment 19) — OWNER/FINANCE only (mirrors the /corporate MANAGE set). Create
 * (name + GeoJSON polygon), list, read one, and patch (rename / redraw / activate-deactivate / reorder).
 * Mutations are idempotent (Idempotency-Key, PRD §11.1). orgId is never a param — it comes off the principal.
 */
@ApiTags('service-zones')
@ApiBearerAuth()
@Controller('service-zones')
@UseInterceptors(IdempotencyInterceptor)
export class ServiceZonesController {
  static readonly MANAGE = [RoleType.OWNER, RoleType.FINANCE];

  constructor(private readonly zones: ServiceZonesService) {}

  @Get()
  @Roles(...ServiceZonesController.MANAGE)
  @ApiOperation({ summary: 'List the org service zones (with polygon GeoJSON), owner/finance only.' })
  list(@CurrentUser() p: RequestPrincipal) {
    return this.zones.listZones(p);
  }

  @Post()
  @Roles(...ServiceZonesController.MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a service zone from a drawn GeoJSON polygon (malformed → 400). Idempotent.' })
  create(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createServiceZoneSchema)) dto: CreateServiceZoneDto) {
    return this.zones.createZone(p, dto);
  }

  @Get(':zoneId')
  @Roles(...ServiceZonesController.MANAGE)
  @ApiOperation({ summary: 'Read one service zone (cross-org → 404).' })
  get(@CurrentUser() p: RequestPrincipal, @Param('zoneId', ParseUUIDPipe) zoneId: string) {
    return this.zones.getZone(p, zoneId);
  }

  @Patch(':zoneId')
  @Roles(...ServiceZonesController.MANAGE)
  @ApiOperation({ summary: 'Rename / redraw / activate-deactivate / reorder a zone (cross-org → 404). Idempotent.' })
  patch(
    @CurrentUser() p: RequestPrincipal,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body(new ZodBody(updateServiceZoneSchema)) dto: UpdateServiceZoneDto,
  ) {
    return this.zones.updateZone(p, zoneId, dto);
  }
}
