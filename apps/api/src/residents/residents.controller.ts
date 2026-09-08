import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  createResidentSchema,
  enrollGarmentSchema,
  listResidentsQuerySchema,
  type CreateResidentDto,
  type EnrollGarmentDto,
  type ListResidentsQuery,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { ResidentService } from './resident.service';
import { GarmentService } from './garment.service';

/**
 * Resident directory + the A4.2 resident-clothing view (Track-B care homes). `/v1/residents` —
 * org/site row-scoped, problem+json. Resident PII reads are RBAC-gated (ops + the account's own
 * staff, their site only) and AUDITED in the service (§12.2). A cross-site (confined principal) or
 * cross-org id never resolves → 404. Garment enrollment lives here too (it is per-resident).
 */
@ApiTags('residents')
@ApiBearerAuth()
@Controller('residents')
@UseInterceptors(IdempotencyInterceptor)
export class ResidentsController {
  /** Resident PII reads — org-wide ops + the account's own staff (their site only). */
  static readonly READ = [RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF];
  /** Create a resident — ops + the care-home admin. */
  static readonly WRITE = [RoleType.OWNER, RoleType.CSR, RoleType.ACCOUNT_ADMIN];
  /** Drive the garment lifecycle (plant sort-station operations). */
  static readonly GARMENT_OPS = [RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP];

  constructor(
    private readonly residents: ResidentService,
    private readonly garments: GarmentService,
  ) {}

  @Post()
  @Roles(...ResidentsController.WRITE)
  @ApiOperation({ summary: 'Create a resident at a site (care home). Org/site-scoped; audited.' })
  create(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createResidentSchema)) dto: CreateResidentDto) {
    return this.residents.create(p, dto);
  }

  @Get()
  @Roles(...ResidentsController.READ)
  @ApiOperation({ summary: "List a site's residents. Audited (§12.2). A site outside scope → 404." })
  list(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listResidentsQuerySchema)) q: ListResidentsQuery) {
    return this.residents.list(p, q);
  }

  @Get(':residentId')
  @Roles(...ResidentsController.READ)
  @ApiOperation({ summary: 'Resident detail. Audited (§12.2). Cross-site/cross-org id → 404.' })
  get(@CurrentUser() p: RequestPrincipal, @Param('residentId', ParseUUIDPipe) residentId: string) {
    return this.residents.get(p, residentId);
  }

  @Get(':residentId/clothing')
  @Roles(...ResidentsController.READ)
  @ApiOperation({ summary: "The A4.2 resident-clothing view — garments in the four buckets (enrolled/in-process/returned/lost&found). Audited." })
  clothing(@CurrentUser() p: RequestPrincipal, @Param('residentId', ParseUUIDPipe) residentId: string) {
    return this.garments.residentClothing(p, residentId);
  }

  @Post(':residentId/garments')
  @Roles(...ResidentsController.GARMENT_OPS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enroll a garment to a resident (tag↔resident → GARMENT_ENROLLED) + opening custody event.' })
  enroll(
    @CurrentUser() p: RequestPrincipal,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @Body(new ZodBody(enrollGarmentSchema)) dto: EnrollGarmentDto,
  ) {
    return this.garments.enroll(p, residentId, dto);
  }
}
