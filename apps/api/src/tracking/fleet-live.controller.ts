import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType } from '@blue-bee/shared';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { TrackingReadService } from './tracking-read.service';

/**
 * Owner/dispatcher fleet tracking (PRD §6.1(b), §11.1 `GET /fleet/live`). Returns every
 * caller-org vehicle's last-known (Redis hot store, Timescale fallback). Org-scoped: a
 * different org sees only its own vehicles. (The live WS fan-out is Increment 6; this is the
 * REST poll.)
 */
@ApiTags('tracking')
@ApiBearerAuth()
@Controller('fleet')
export class FleetLiveController {
  constructor(private readonly read: TrackingReadService) {}

  @Get('live')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  @ApiOperation({ summary: "All of the caller-org's vehicles' last-known position (Redis → Timescale fallback)." })
  fleetLive(@CurrentUser() p: RequestPrincipal) {
    return this.read.fleetLive(p);
  }
}
