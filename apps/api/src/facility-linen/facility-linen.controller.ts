import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  adjustLinenStockSchema,
  generatePackToParSchema,
  listLinenStockQuerySchema,
  listPackToParManifestsQuerySchema,
  listParLevelsQuerySchema,
  listSoilPickupsQuerySchema,
  packToParQuerySchema,
  recordDriverSoilPickupSchema,
  recordSoilPickupSchema,
  setParLevelSchema,
  updateParLevelSchema,
  type AdjustLinenStockDto,
  type GeneratePackToParDto,
  type ListLinenStockQuery,
  type ListPackToParManifestsQuery,
  type ListParLevelsQuery,
  type ListSoilPickupsQuery,
  type PackToParQuery,
  type RecordDriverSoilPickupDto,
  type RecordSoilPickupDto,
  type SetParLevelDto,
  type UpdateParLevelDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { FacilityLinenService } from './facility-linen.service';

/** RBAC (§17.3). Par is account-management (OWNER/CSR); on-hand corrections are plant/ops; soiled-cart
 *  pickups + pack-to-par generation are ops; reads add the owning account's own staff (site-scoped). */
const PAR_WRITE = [RoleType.OWNER, RoleType.CSR];
const STOCK_ADJUST = [RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP];
const LINEN_OPS = [RoleType.OWNER, RoleType.CSR, RoleType.DISPATCHER];
const LINEN_READ = [RoleType.OWNER, RoleType.CSR, RoleType.DISPATCHER, RoleType.PLANT_OP, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF];

/**
 * Facility-linen par loop — the ops console surface (Track B Phase 2, PRD §2.2/§5.2/§B3). Site-scoped
 * `/v1/sites/:siteId/...` routes for par levels, on-hand, soiled-cart pickups, and the pack-to-par load
 * sheet. Org-scoped + problem+json + audited; account principals are confined by row-scoping to their own
 * sites (a cross-account site id → 404).
 */
@ApiTags('facility-linen')
@ApiBearerAuth()
@Controller('sites')
export class FacilityLinenController {
  constructor(private readonly service: FacilityLinenService) {}

  // ── par levels ──

  @Post(':siteId/par-levels')
  @Roles(...PAR_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Set (upsert) a par target for a (site, cost-centre?, SKU). OWNER/CSR; cross-account site → 404.' })
  setPar(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Body(new ZodBody(setParLevelSchema)) dto: SetParLevelDto) {
    return this.service.setPar(p, siteId, dto);
  }

  @Get(':siteId/par-levels')
  @Roles(...LINEN_READ)
  @ApiOperation({ summary: "List a site's par levels (optional ?costCenterId). Account staff see only their own sites." })
  listPar(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Query(new ZodBody(listParLevelsQuerySchema)) q: ListParLevelsQuery) {
    return this.service.listPar(p, siteId, q);
  }

  // ── on-hand stock ──

  @Get(':siteId/linen-stock')
  @Roles(...LINEN_READ)
  @ApiOperation({ summary: "Current on-hand per (cost-centre?, SKU) for a site (the ledger's cached aggregate)." })
  listStock(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Query(new ZodBody(listLinenStockQuerySchema)) q: ListLinenStockQuery) {
    return this.service.listStock(p, siteId, q);
  }

  @Post(':siteId/linen-stock/adjust')
  @Roles(...STOCK_ADJUST)
  @ApiOperation({ summary: 'Set on-hand to an absolute target → an append-only ADJUSTMENT movement of (target − current). OWNER/CSR/PLANT_OP.' })
  adjustStock(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Body(new ZodBody(adjustLinenStockSchema)) dto: AdjustLinenStockDto) {
    return this.service.adjustStock(p, siteId, dto);
  }

  // ── soiled-cart pickup ──

  @Post(':siteId/soil-pickups')
  @Roles(...LINEN_OPS)
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a soiled-cart pickup (cart/bag + weight + per-SKU counts) → decrements on-hand + custody event. OWNER/CSR/DISPATCHER.' })
  recordPickup(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Body(new ZodBody(recordSoilPickupSchema)) dto: RecordSoilPickupDto) {
    return this.service.recordSoilPickup(p, siteId, dto);
  }

  @Get(':siteId/soil-pickups')
  @Roles(...LINEN_READ)
  @ApiOperation({ summary: "A site's soiled-cart pickup history (the account's confirmation feed). Account staff see only their own sites." })
  listPickups(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Query(new ZodBody(listSoilPickupsQuerySchema)) q: ListSoilPickupsQuery) {
    return this.service.listSoilPickups(p, siteId, q);
  }

  // ── pack-to-par load sheet ──

  @Get(':siteId/pack-to-par')
  @Roles(...LINEN_READ)
  @ApiOperation({ summary: 'Live pack-to-par: gap = max(0, par − on-hand) per SKU (optional ?costCenterId). Account staff see only their own sites.' })
  packToPar(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Query(new ZodBody(packToParQuerySchema)) q: PackToParQuery) {
    return this.service.packToPar(p, siteId, q);
  }

  @Post(':siteId/pack-to-par')
  @Roles(...LINEN_OPS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Snapshot the current pack-to-par gaps into a Manifest (the §B3.2 load sheet). OWNER/CSR/DISPATCHER.' })
  generatePackToPar(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Body(new ZodBody(generatePackToParSchema)) dto: GeneratePackToParDto) {
    return this.service.generatePackToPar(p, siteId, dto);
  }

  @Get(':siteId/pack-to-par/manifests')
  @Roles(...LINEN_READ)
  @ApiOperation({ summary: "A site's generated pack-to-par load sheets (most recent first)." })
  listPackToParManifests(@CurrentUser() p: RequestPrincipal, @Param('siteId', ParseUUIDPipe) siteId: string, @Query(new ZodBody(listPackToParManifestsQuerySchema)) q: ListPackToParManifestsQuery) {
    return this.service.listPackToParManifests(p, siteId, q);
  }
}

/**
 * Par level mutation by id (rename/re-target). `PATCH /v1/par-levels/:id` — separated from the site-scoped
 * controller so the id-addressed update has its own clean base path (mirrors CostCenterAdminController).
 */
@ApiTags('facility-linen')
@ApiBearerAuth()
@Controller('par-levels')
export class ParLevelController {
  constructor(private readonly service: FacilityLinenService) {}

  @Patch(':id')
  @Roles(...PAR_WRITE)
  @ApiOperation({ summary: 'Update a par level target by id (OWNER/CSR; cross-org/account id → 404). Audited.' })
  update(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(updateParLevelSchema)) dto: UpdateParLevelDto) {
    return this.service.updatePar(p, id, dto);
  }
}

/**
 * Driver self-scoped soiled-cart pickup (Inc-9 template). `POST /v1/driver/stops/:stopId/soil-pickup` —
 * the caller's DRIVER profile must own the stop's route; the site is derived from the stop. The driver-app
 * capture UI is a deferred follow-up — this increment ships the endpoint behind the proven self-scope.
 */
@ApiTags('facility-linen')
@ApiBearerAuth()
@Controller('driver')
export class DriverSoilPickupController {
  constructor(private readonly service: FacilityLinenService) {}

  @Post('stops/:stopId/soil-pickup')
  @Roles(RoleType.DRIVER)
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Driver records a soiled-cart pickup at their own SOIL_PICKUP stop (route.driverId verified → 403 otherwise).' })
  recordPickup(@CurrentUser() p: RequestPrincipal, @Param('stopId', ParseUUIDPipe) stopId: string, @Body(new ZodBody(recordDriverSoilPickupSchema)) dto: RecordDriverSoilPickupDto) {
    return this.service.recordSoilPickupAsDriver(p, stopId, dto);
  }
}
