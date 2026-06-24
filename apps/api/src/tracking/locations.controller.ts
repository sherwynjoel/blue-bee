import { Body, Controller, HttpCode, HttpStatus, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType, locationBatchSchema, type LocationBatchDto } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { IngestionService } from './ingestion.service';

/**
 * Location ingestion (PRD §11.1 DRIVER `POST /locations:batch`, §6.2/§10.4). DRIVER posts
 * for their own active shift; OWNER may post for ops/backfill (§17.3 DRIVER_SCAN_POD =
 * OWNER+DRIVER). Mutation is idempotent (Idempotency-Key) on top of the data-layer dedup.
 *
 * Empty controller base + an escaped-colon method path so the route is exactly
 * `/v1/locations:batch` (the resource:verb form used across this API, e.g. `quote:approve`).
 */
@ApiTags('tracking')
@ApiBearerAuth()
@Controller()
@UseInterceptors(IdempotencyInterceptor)
export class LocationsController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('locations\\:batch')
  @Roles(RoleType.OWNER, RoleType.DRIVER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ingest a batch of GPS pings for an ACTIVE shift+vehicle → Redis last-known + Timescale history. Shift-gated, scoped, deduped, recorded_at-authoritative.',
  })
  batch(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(locationBatchSchema)) dto: LocationBatchDto) {
    return this.ingestion.ingest(p, dto);
  }
}
