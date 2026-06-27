import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  createPaymentIntentSchema,
  generateInvoiceSchema,
  payInvoiceSchema,
  refundPaymentSchema,
  type CreatePaymentIntentDto,
  type GenerateInvoiceDto,
  type PayInvoiceDto,
  type RefundPaymentDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { PaymentService } from './payment.service';
import { BillingService } from './billing.service';
import { RefundService } from './refund.service';
import { DisputeService } from './dispute.service';

/**
 * Payments / billing endpoints (Increment 12, §11 BILLING). Customer take-payment (own order) +
 * owner/finance refund / invoice / dispute reads. RBAC per §17.3 via @Roles; horizontal (account)
 * scope is enforced in the services (the parent-ownership gate → a customer pays/reads only their
 * own order). The webhook lives on its own @Public controller. Idempotency-Key makes mutations
 * replay-safe (Increment-1 convention).
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller()
@UseInterceptors(IdempotencyInterceptor)
export class PaymentsController {
  constructor(
    private readonly payments: PaymentService,
    private readonly billing: BillingService,
    private readonly refunds: RefundService,
    private readonly disputes: DisputeService,
  ) {}

  // ─────────────────────────── customer: pay (own order) ───────────────────────────

  @Post('orders/:id/payment-intent')
  @Roles(RoleType.OWNER, RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create/re-attempt the PaymentIntent for an approved order (server-computed amount). Returns the client secret only (PCI SAQ-A).' })
  createIntent(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(createPaymentIntentSchema)) dto: CreatePaymentIntentDto) {
    return this.payments.createIntent(p, id, dto);
  }

  @Get('orders/:id/payment')
  @ApiOperation({ summary: "The order's latest payment (scoped). The app polls this to confirm a webhook-confirmed success." })
  getPayment(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.payments.getPaymentForOrder(p, id);
  }

  @Get('orders/:id/invoice')
  @ApiOperation({ summary: "The order's invoice/receipt (scoped), or null." })
  getInvoice(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.billing.getInvoiceForOrder(p, id);
  }

  // ─────────────────────────── B2B portal: pay an invoice (invoice-level) ───────────────────────────

  @Post('invoices/:id/payment-intent')
  @Roles(RoleType.OWNER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create/re-attempt the PaymentIntent for an invoice (B2B portal). Amount = the invoice total incl. HST, computed server-side. Returns the client secret only; the invoice flips PAID only on the signed webhook.' })
  createInvoiceIntent(@CurrentUser() p: RequestPrincipal, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodBody(payInvoiceSchema)) dto: PayInvoiceDto) {
    return this.payments.createInvoiceIntent(p, id, dto);
  }

  @Get('invoices/:id/payment')
  @Roles(RoleType.OWNER, RoleType.FINANCE, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF)
  @ApiOperation({ summary: "The invoice's latest payment (scoped). The portal polls this / the invoice until the webhook confirms success." })
  getInvoicePayment(@CurrentUser() p: RequestPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.getPaymentForInvoice(p, id);
  }

  // ─────────────────────────── owner / finance ───────────────────────────

  @Post('orders/:id/invoice')
  @Roles(RoleType.OWNER, RoleType.FINANCE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate (+ finalize/send) an invoice for an order from its approved quote (owner/finance).' })
  generateInvoice(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(generateInvoiceSchema)) dto: GenerateInvoiceDto) {
    return this.billing.generateInvoice(p, id, dto);
  }

  @Post('payments/:id/refund')
  @Roles(RoleType.OWNER, RoleType.FINANCE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Refund a captured payment — full (omit amount) or partial (owner/finance).' })
  refund(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(refundPaymentSchema)) dto: RefundPaymentDto) {
    return this.refunds.refund(p, id, dto);
  }

  @Get('disputes')
  @Roles(RoleType.OWNER, RoleType.FINANCE)
  @ApiOperation({ summary: 'List the org disputes (owner/finance). The owner-app screens land later; the API + state are built now.' })
  listDisputes(@CurrentUser() p: RequestPrincipal) {
    return this.disputes.listDisputes(p);
  }
}
