import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  createRatingSchema,
  patchRatingSchema,
  type CreateRatingDto,
  type PatchRatingDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { RatingsService } from './ratings.service';

/**
 * [Inc-32] Post-delivery ratings / CSAT (PRD A6.3). Routes hang UNDER the order (`/v1/orders/:id/rating`)
 * so the parent-ownership gate scopes them. Write access is customer-side only (§17.3) — OWNER/CSR/plant
 * cannot rate; they only READ the rating for the console. Idempotency-keyed (class interceptor) so a
 * retried submit replays the first result.
 */
@ApiTags('ratings')
@ApiBearerAuth()
@Controller('orders')
@UseInterceptors(IdempotencyInterceptor)
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post(':id/rating')
  @Roles(RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Rate a delivered order (owning customer; 1–5 + optional comment). One rating per order.' })
  create(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(createRatingSchema)) dto: CreateRatingDto) {
    return this.ratings.create(p, id, dto);
  }

  @Patch(':id/rating')
  @Roles(RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revise your rating (original submitter only, within the 30-day edit window).' })
  update(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(patchRatingSchema)) dto: PatchRatingDto) {
    return this.ratings.update(p, id, dto);
  }

  @Get(':id/rating')
  @Roles(RoleType.OWNER, RoleType.CSR, RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN)
  @ApiOperation({ summary: 'Read an order’s rating (owning customer, or OWNER/CSR for the console). 404 if unrated.' })
  get(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.ratings.get(p, id);
  }
}
