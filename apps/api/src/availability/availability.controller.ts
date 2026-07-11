import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RoleType, pickupSlotsQuerySchema, type PickupSlotsQuery } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AvailabilityService } from './availability.service';

/**
 * Pickup availability (Increment 28) — the customer-scoped read behind the Book screen's date/slot picker.
 *
 * Gated to the same customer-side roles as `SitesController.MANAGE`: this answers "when may *you* book",
 * and the row-scoped `siteId` lookup is meaningless for an unconfined org-staff principal. Ops staff who
 * need to see the org's hours read them through the OWNER-gated `GET /v1/admin/settings/schedule`.
 */
@ApiTags('availability')
@ApiBearerAuth()
@Controller('availability')
export class AvailabilityController {
  /** The customer-side principals who book their own pickups (mirrors `SitesController.MANAGE`). */
  static readonly BOOKERS = [RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF];

  constructor(private readonly availability: AvailabilityService) {}

  @Get('pickup-slots')
  @Roles(...AvailabilityController.BOOKERS)
  @ApiOperation({
    summary:
      "The day's pickup windows for the caller. Windows come from the org's saved schedule (or the labelled default); a slot is unavailable only for a real reason — it has passed, it is inside the lead time, or a configured per-slot cap is met. With no cap configured `capacityChecked` is false and nothing is marked full.",
  })
  @ApiQuery({ name: 'date', required: false, description: 'Business-local YYYY-MM-DD. Omit for the first bookable day.' })
  @ApiQuery({ name: 'siteId', required: false, description: "The pickup address. Another account's site → 404." })
  pickupSlots(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(pickupSlotsQuerySchema)) query: PickupSlotsQuery) {
    return this.availability.pickupSlots(p, query);
  }
}
