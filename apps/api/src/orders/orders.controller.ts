import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  approveQuoteSchema,
  bookOrderSchema,
  captureWeightSchema,
  declineQuoteSchema,
  holdOrderSchema,
  inspectionSchema,
  listOrdersQuerySchema,
  quoteBuildSchema,
  receivedAtPlantSchema,
  resumeOrderSchema,
  schedulePickupSchema,
  type ApproveQuoteDto,
  type BookOrderDto,
  type CaptureWeightDto,
  type DeclineQuoteDto,
  type HoldOrderDto,
  type InspectionDto,
  type ListOrdersQuery,
  type QuoteBuildDto,
  type ReceivedAtPlantDto,
  type ResumeOrderDto,
  type SchedulePickupDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { IntakeService } from './intake.service';
import { OrdersService } from './orders.service';
import { QuoteService } from './quote.service';
import { WeighService } from './weigh.service';

/**
 * Specialty order endpoints (PRD §11.1, §5.1, §8.3) — book → intake/inspection →
 * quote → approve/decline. RBAC per §17.3 is declared with @Roles; horizontal
 * (account) scope is enforced in the services via the parent-ownership gate. The
 * IdempotencyInterceptor makes mutations replay-safe (Increment-1 convention).
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@UseInterceptors(IdempotencyInterceptor)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly intake: IntakeService,
    private readonly quote: QuoteService,
    private readonly weigh: WeighService,
  ) {}

  // ─────────────────────────── book + read/list ───────────────────────────

  @Post()
  @Roles(RoleType.OWNER, RoleType.CSR, RoleType.RESIDENTIAL_CUSTOMER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Book a specialty job (PRD §7A A2.1) — Order(REQUESTED) + Items + Tags + estimate range. Idempotent.' })
  book(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(bookOrderSchema)) dto: BookOrderDto) {
    return this.orders.book(p, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List orders (row-scoped, cursor pagination — PRD §11.1, §17.3).' })
  list(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listOrdersQuerySchema)) q: ListOrdersQuery) {
    return this.orders.listOrders(p, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one order with items, custody, inspections, photos and quotes (scoped).' })
  get(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.orders.getOrder(p, id);
  }

  // ─────────────────────────── pickup / receive (staff) ───────────────────────────

  @Post(':id/schedule-pickup')
  @Roles(RoleType.OWNER, RoleType.CSR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm/schedule the pickup window (REQUESTED → SCHEDULED_PICKUP).' })
  schedulePickup(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(schedulePickupSchema)) dto: SchedulePickupDto) {
    return this.intake.schedulePickup(p, id, dto);
  }

  @Post(':id/received-at-plant')
  @Roles(RoleType.OWNER, RoleType.CSR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authorized manual receive → drives the pickup spine to PICKED_UP (no driver fabricated; real scans land in Increment 4).' })
  receivedAtPlant(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(receivedAtPlantSchema)) dto: ReceivedAtPlantDto) {
    return this.intake.receivedAtPlant(p, id, dto);
  }

  // ─────────────────────────── intake / inspection (§17.3 intake/inspect/quote) ───────────────────────────

  @Post(':id/items/:itemId/inspection')
  @Roles(RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record inspection (condition codes, measurements, pre-existing-damage ack) + custody (PRD §8.3, §5.1).' })
  inspect(
    @CurrentUser() p: RequestPrincipal,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodBody(inspectionSchema)) dto: InspectionDto,
  ) {
    return this.intake.inspect(p, id, itemId, dto);
  }

  // Item photos (intake / before / after) are uploaded via the real presigned flow —
  // POST /v1/media/presign → PUT → POST /v1/media/confirm (Increment 10). The legacy
  // register-a-URL endpoint here is retired.

  @Post(':id/quote')
  @Roles(RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Build the quote (auto-calc service×measure×rate + upcharges, per-account override, HST; manual adjust audited) → QUOTED.' })
  buildQuote(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(quoteBuildSchema)) dto: QuoteBuildDto) {
    return this.quote.build(p, id, dto);
  }

  // ─────────────────────────── approve / decline (owning customer + OWNER) ───────────────────────────

  @Post(':id/quote\\:approve')
  @Roles(RoleType.OWNER, RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve the quote (owning customer or OWNER) → QUOTE_APPROVED. No charge (payment deferred to billing increment).' })
  approve(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(approveQuoteSchema)) dto: ApproveQuoteDto) {
    return this.quote.approve(p, id, dto);
  }

  @Post(':id/quote\\:decline')
  @Roles(RoleType.OWNER, RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline the quote → QUOTE_DECLINED → schedule return → CLOSED_NO_WORK (§5.1 branch).' })
  decline(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(declineQuoteSchema)) dto: DeclineQuoteDto) {
    return this.quote.decline(p, id, dto);
  }

  // ─────────────────────────── weigh (Inc-22 — driver/plant weight → hybrid pricing) ───────────────────────────

  @Post(':id/weigh')
  @Roles(RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP, RoleType.DRIVER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Approve an actual weight (append-only, idempotent) → the authoritative weight; runs the hybrid pricing gate (all-FIXED auto-priced+approved at the published rate; a FROM_MEASURED specialty line → quote SENT for customer approval) and emits the live weight push.',
  })
  weighLoad(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(captureWeightSchema)) dto: CaptureWeightDto) {
    return this.weigh.weigh(p, id, dto);
  }

  @Get(':id/weight')
  // Staff + the OWNING customer (Inc-23 P4 — "Weighed X kg → $Y" live line). getOrderForRead's scoped
  // client enforces ownership, so a customer only ever reads their OWN order's weight.
  @Roles(
    RoleType.OWNER,
    RoleType.CSR,
    RoleType.PLANT_OP,
    RoleType.DRIVER,
    RoleType.DISPATCHER,
    RoleType.FINANCE,
    RoleType.RESIDENTIAL_CUSTOMER,
    RoleType.ACCOUNT_ADMIN,
    RoleType.ACCOUNT_STAFF,
  )
  @ApiOperation({ summary: 'The order authoritative weight (most recent capture) + the full append-only capture history.' })
  orderWeight(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.weigh.getOrderWeight(p, id);
  }

  // ─────────────────────────── hold / resume (staff) ───────────────────────────

  @Post(':id/hold')
  @Roles(RoleType.OWNER, RoleType.CSR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Place the order ON_HOLD with a reason (any active state → ON_HOLD, §5.1).' })
  hold(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(holdOrderSchema)) dto: HoldOrderDto) {
    return this.orders.hold(p, id, dto);
  }

  @Post(':id/resume')
  @Roles(RoleType.OWNER, RoleType.CSR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume an ON_HOLD order back to the state it was paused in (heldFrom).' })
  resume(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(resumeOrderSchema)) dto: ResumeOrderDto) {
    return this.orders.resume(p, id, dto);
  }
}
