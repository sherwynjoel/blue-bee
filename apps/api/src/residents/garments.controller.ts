import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  dropToLostFoundSchema,
  transitionGarmentSchema,
  type DropToLostFoundDto,
  type TransitionGarmentDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { GarmentService } from './garment.service';
import { ResidentsController } from './residents.controller';

/**
 * Garment lifecycle transitions (Track-B care homes, PRD §5.2-B). `/v1/garments/:id/*` — server-
 * authoritative, append-only custody, illegal transition → 409. Plant sort-station operations
 * (OWNER/CSR/PLANT_OP). The LINEAR moves go through `:id/transition`; the lost & found branch entry
 * is its own route (it also writes a LostFoundItem).
 */
@ApiTags('garments')
@ApiBearerAuth()
@Controller('garments')
export class GarmentsController {
  constructor(private readonly garments: GarmentService) {}

  @Post(':garmentId/transition')
  @Roles(...ResidentsController.GARMENT_OPS)
  @ApiOperation({ summary: 'Advance a garment one step along the §5.2-B lifecycle. Illegal transition → 409; a branch target → 400.' })
  transition(
    @CurrentUser() p: RequestPrincipal,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Body(new ZodBody(transitionGarmentSchema)) dto: TransitionGarmentDto,
  ) {
    return this.garments.transition(p, garmentId, dto);
  }

  @Post(':garmentId/lost-found')
  @Roles(...ResidentsController.GARMENT_OPS)
  @ApiOperation({ summary: 'Drop an odd/unmatched garment into the site lost & found pool (RETURN_SORT → LOST_FOUND_POOL).' })
  lostFound(
    @CurrentUser() p: RequestPrincipal,
    @Param('garmentId', ParseUUIDPipe) garmentId: string,
    @Body(new ZodBody(dropToLostFoundSchema)) dto: DropToLostFoundDto,
  ) {
    return this.garments.dropToLostFound(p, garmentId, dto);
  }
}
