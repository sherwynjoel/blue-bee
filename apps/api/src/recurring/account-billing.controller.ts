import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  batchInvoiceSchema,
  setBillingTermsSchema,
  type BatchInvoiceDto,
  type SetBillingTermsDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { AccountBillingService } from './account-billing.service';
import { StandingOrderService } from './standing-order.service';

/**
 * Per-account billing terms + the batch/periodic invoicing path + the generated-orders feed (Track A,
 * PRD §9.1 / §11). `/v1/accounts/:accountId/...` — org-scoped, problem+json, audited. RBAC (§17.3):
 * billing terms + batch invoicing are finance-sensitive (OWNER/FINANCE); the generated feed is ops/
 * finance read. Distinct sub-paths (billing-terms, invoices/batch, generated) so it never collides
 * with another module's account routes.
 */
@ApiTags('account-billing')
@ApiBearerAuth()
@Controller('accounts')
@UseInterceptors(IdempotencyInterceptor)
export class AccountBillingController {
  static readonly FINANCE = [RoleType.OWNER, RoleType.FINANCE];
  static readonly OPS_FINANCE_READ = [RoleType.OWNER, RoleType.FINANCE, RoleType.DISPATCHER, RoleType.CSR];

  constructor(
    private readonly billing: AccountBillingService,
    private readonly standingOrders: StandingOrderService,
  ) {}

  @Get(':accountId/billing-terms')
  @Roles(...AccountBillingController.FINANCE)
  @ApiOperation({ summary: 'Read an account\'s billing terms (mode + net-days). Org-scoped; cross-org id → 404.' })
  getTerms(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.billing.getBillingTerms(p, accountId);
  }

  @Put(':accountId/billing-terms')
  @Roles(...AccountBillingController.FINANCE)
  @ApiOperation({ summary: 'Set an account\'s billing terms — PER_ORDER | BATCH_PERIODIC + net-days (audited).' })
  setTerms(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string, @Body(new ZodBody(setBillingTermsSchema)) dto: SetBillingTermsDto) {
    return this.billing.setBillingTerms(p, accountId, dto);
  }

  @Post(':accountId/invoices/batch')
  @Roles(...AccountBillingController.FINANCE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate ONE periodic invoice batching the account\'s billable orders in a window (net-days due). Idempotent per (account, period). Audited.' })
  batchInvoice(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string, @Body(new ZodBody(batchInvoiceSchema)) dto: BatchInvoiceDto) {
    return this.billing.generateBatchInvoice(p, accountId, dto);
  }

  @Get(':accountId/generated')
  @Roles(...AccountBillingController.OPS_FINANCE_READ)
  @ApiOperation({ summary: 'List the orders/routes generated from this account\'s standing orders (the lean B2B feed).' })
  generated(@CurrentUser() p: RequestPrincipal, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.standingOrders.generatedForAccount(p, accountId);
  }
}
