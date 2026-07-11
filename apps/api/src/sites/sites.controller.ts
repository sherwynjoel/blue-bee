import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType, createSiteSchema, updateSiteSchema, type CreateSiteDto, type UpdateSiteDto } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { SitesService } from './sites.service';

/**
 * Saved addresses (Increment 26) — the customer-owned WRITE side of `Site`. The READ side (`GET /v1/sites`)
 * stays on CatalogController with the rest of the booking-context reads.
 *
 * ROLE GATE. Unlike CatalogController (no `@Roles` — a read any authenticated principal may make), every
 * route here is gated to the customer-side roles. Org staff manage addresses through the console/corporate
 * surfaces, and `SitesService.resolveAccountId` would in any case reject an unconfined principal.
 *
 * ROUTES. `POST /v1/sites` and `PATCH /v1/sites/:id` do not collide with FacilityLinenController's
 * `@Controller('sites')`, which only registers three-segment `sites/:siteId/<noun>` routes. The escaped
 * colon in `:id\:deactivate` follows the as-built resource:verb convention (`orders/:id/quote\:approve`,
 * `route-stops/:id\:depart`) — under Express 4's path-to-regexp the backslash keeps `:deactivate` a literal
 * so `:id` captures the bare UUID.
 */
@ApiTags('sites')
@ApiBearerAuth()
@Controller('sites')
@UseInterceptors(IdempotencyInterceptor)
export class SitesController {
  /** The customer-side principals who own their account's addresses. */
  static readonly MANAGE = [RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF];

  constructor(private readonly sites: SitesService) {}

  @Post()
  @Roles(...SitesController.MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Save a new address. The server geocodes `address` (or accepts a map-picked `geo`) and answers serviceability; an unresolvable address is 422 and writes nothing. Idempotent.',
  })
  create(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createSiteSchema)) dto: CreateSiteDto) {
    return this.sites.create(p, dto);
  }

  @Patch(':id')
  @Roles(...SitesController.MANAGE)
  @ApiOperation({
    summary:
      "Edit a saved address (re-geocodes only when the address or pin moves). Another account's site → 404. Idempotent.",
  })
  update(
    @CurrentUser() p: RequestPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBody(updateSiteSchema)) dto: UpdateSiteDto,
  ) {
    return this.sites.update(p, id, dto);
  }

  @Post(':id\\:deactivate')
  @Roles(...SitesController.MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Remove a saved address. Soft delete (`active = false`) because past orders reference it; promotes the next address to default when this one held it. Repeatable.',
  })
  deactivate(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.deactivate(p, id);
  }
}
