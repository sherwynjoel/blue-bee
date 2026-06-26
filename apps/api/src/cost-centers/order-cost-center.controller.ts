import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType, attachOrderCostCenterSchema, type AttachOrderCostCenterDto } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { CostCentersService } from './cost-centers.service';

/**
 * Order cost-centre attribution (Track A Phase 2). `PUT /v1/orders/:id/cost-center` — attach (or detach
 * with `null`) a cost centre to an order. Orthogonal metadata: it never moves the §5.1 order state.
 * RBAC (§17.3): ops/finance (OWNER/FINANCE/DISPATCHER/CSR). Own-org + cost-centre-account-match enforced
 * in the service; audited. A distinct sub-path that never collides with the existing order routes.
 */
@ApiTags('cost-centers')
@ApiBearerAuth()
@Controller('orders')
export class OrderCostCenterController {
  static readonly OPS_FINANCE = [RoleType.OWNER, RoleType.FINANCE, RoleType.DISPATCHER, RoleType.CSR];

  constructor(private readonly service: CostCentersService) {}

  @Put(':id/cost-center')
  @Roles(...OrderCostCenterController.OPS_FINANCE)
  @ApiOperation({ summary: "Attach (or detach with null) a cost centre to an order. Cross-org order → 404; cost centre from another account → 400. Audited." })
  attach(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(attachOrderCostCenterSchema)) dto: AttachOrderCostCenterDto) {
    return this.service.attachOrder(p, id, dto);
  }
}
