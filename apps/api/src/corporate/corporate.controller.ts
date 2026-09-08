import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  createBuildingSchema,
  createCorporateAccountSchema,
  generateJoinCodeSchema,
  redeemJoinCodeSchema,
  setRateCardItemSchema,
  updateBuildingSchema,
  updateCorporateAccountSchema,
  type CreateBuildingDto,
  type CreateCorporateAccountDto,
  type GenerateJoinCodeDto,
  type RedeemJoinCodeDto,
  type SetRateCardItemDto,
  type UpdateBuildingDto,
  type UpdateCorporateAccountDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CorporateService } from './corporate.service';

/**
 * Corporate accounts + per-account rate cards + buildings + join codes (Increment 15). `/v1/corporate/*` —
 * org-scoped, problem+json, every mutation audited.
 *
 * RBAC (§17.3): the management surface (accounts / buildings / rate card / join-code generation) is
 * OWNER/FINANCE only — a member can never edit pricing (RolesGuard → 403). The MEMBER surface
 * (`POST /redeem`, `GET /memberships`) has NO `@Roles`, so any authenticated user may redeem a code and
 * read their OWN memberships (the global JwtAuthGuard is the only gate). The customer-app screen that
 * drives `/redeem` is the next increment; the engine + endpoint ship + are e2e-tested now.
 */
@ApiTags('corporate')
@ApiBearerAuth()
@Controller('corporate')
@UseInterceptors(IdempotencyInterceptor)
export class CorporateController {
  static readonly MANAGE = [RoleType.OWNER, RoleType.FINANCE];

  constructor(private readonly corporate: CorporateService) {}

  // ── accounts ──

  @Post('accounts')
  @Roles(...CorporateController.MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a corporate account (BUSINESS, PER_ORDER, corporate=true). Audited. OWNER/FINANCE.' })
  createAccount(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createCorporateAccountSchema)) dto: CreateCorporateAccountDto) {
    return this.corporate.createAccount(p, dto);
  }

  @Get('accounts')
  @Roles(...CorporateController.MANAGE)
  @ApiOperation({ summary: 'List corporate accounts (org-scoped) with building + member counts.' })
  listAccounts(@CurrentUser() p: RequestPrincipal) {
    return this.corporate.listAccounts(p);
  }

  @Get('accounts/:accountId')
  @Roles(...CorporateController.MANAGE)
  @ApiOperation({ summary: 'Read one corporate account (cross-org → 404; non-corporate account → 400).' })
  getAccount(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.corporate.getAccount(p, accountId);
  }

  @Patch('accounts/:accountId')
  @Roles(...CorporateController.MANAGE)
  @ApiOperation({ summary: 'Rename a corporate account (audited).' })
  updateAccount(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string, @Body(new ZodBody(updateCorporateAccountSchema)) dto: UpdateCorporateAccountDto) {
    return this.corporate.updateAccount(p, accountId, dto);
  }

  // ── buildings (Site + match boundary) ──

  @Get('accounts/:accountId/buildings')
  @Roles(...CorporateController.MANAGE)
  @ApiOperation({ summary: "List a corporate account's buildings (geo point + match radius)." })
  listBuildings(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.corporate.listBuildings(p, accountId);
  }

  @Post('accounts/:accountId/buildings')
  @Roles(...CorporateController.MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a building (name + address → geo point + match radius, real PostGIS). Audited.' })
  createBuilding(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string, @Body(new ZodBody(createBuildingSchema)) dto: CreateBuildingDto) {
    return this.corporate.createBuilding(p, accountId, dto);
  }

  @Patch('buildings/:siteId')
  @Roles(...CorporateController.MANAGE)
  @ApiOperation({ summary: 'Edit a building (name / address / geo / match radius). Audited.' })
  updateBuilding(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Body(new ZodBody(updateBuildingSchema)) dto: UpdateBuildingDto) {
    return this.corporate.updateBuilding(p, siteId, dto);
  }

  // ── rate card ──

  @Get('accounts/:accountId/rate-card')
  @Roles(...CorporateController.MANAGE)
  @ApiOperation({ summary: "The account's rate card — every catalog service with its account rate, default rate, and the RESOLVED effective rate + source." })
  getRateCard(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.corporate.getRateCard(p, accountId);
  }

  @Put('accounts/:accountId/rate-card/items/:serviceId')
  @Roles(...CorporateController.MANAGE)
  @ApiOperation({ summary: 'Set the account rate for one service (per-pound LB / per-item ITEM). Upserts the account PriceListItem. Audited.' })
  setRateCardItem(
    @CurrentUser() p: RequestPrincipal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body(new ZodBody(setRateCardItemSchema)) dto: SetRateCardItemDto,
  ) {
    return this.corporate.setRateCardItem(p, accountId, serviceId, dto);
  }

  // ── join code ──

  @Post('accounts/:accountId/join-code')
  @Roles(...CorporateController.MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate/regenerate the account join code (optional expiry). Audited.' })
  generateJoinCode(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string, @Body(new ZodBody(generateJoinCodeSchema)) dto: GenerateJoinCodeDto) {
    return this.corporate.generateJoinCode(p, accountId, dto);
  }

  // ── member surface (any authenticated user; the customer-app screen is the next increment) ──

  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Redeem a join code → a pricing-only corporate membership for the caller. Idempotent; bad/expired code → 400. Authenticated.' })
  redeem(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(redeemJoinCodeSchema)) dto: RedeemJoinCodeDto) {
    return this.corporate.redeem(p, dto);
  }

  @Get('memberships')
  @ApiOperation({ summary: "The caller's own corporate memberships (userId-scoped — never another user's). Authenticated." })
  listMyMemberships(@CurrentUser() p: RequestPrincipal) {
    return this.corporate.listMyMemberships(p);
  }
}
