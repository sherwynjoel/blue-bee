import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RoleType, listInvoicesQuerySchema, type ListInvoicesQuery } from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { InvoicesService } from './invoices.service';

/**
 * B2B self-serve invoice portal — account-admin invoice READS + the PDF statement (Track A).
 * `GET /v1/invoices` (the caller's own account's invoices, cursor-paginated), `GET /v1/invoices/:id`
 * (header + lines + the cost-centre split), `GET /v1/invoices/:id/statement.pdf` (real PDF bytes).
 * RBAC (§17.3): ACCOUNT_ADMIN/ACCOUNT_STAFF (self-serve) + OWNER/FINANCE (support). Horizontal scope is
 * enforced in the service via `scopedPrisma` — a confined account principal sees ONLY their own account
 * (a cross-account/cross-org id → 404, never a leak). The invoice-level PAY endpoint lives on the
 * payments controller (the proven idempotent payment rail).
 */
@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  static readonly READ_ROLES = [RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF, RoleType.OWNER, RoleType.FINANCE];

  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @Roles(...InvoicesController.READ_ROLES)
  @ApiOperation({ summary: "List the caller's invoices (cursor-paginated). Account roles are confined to their own account's invoices." })
  list(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listInvoicesQuerySchema)) q: ListInvoicesQuery) {
    return this.invoices.list(p, q);
  }

  @Get(':id')
  @Roles(...InvoicesController.READ_ROLES)
  @ApiOperation({ summary: 'Invoice detail — header + lines + the cost-centre split. Org+account scoped; an out-of-scope id → 404.' })
  get(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(p, id);
  }

  @Get(':id/statement.pdf')
  @Roles(...InvoicesController.READ_ROLES)
  @ApiOperation({ summary: 'Download the invoice statement as a real PDF (account-scoped attachment).' })
  async statement(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { filename, pdf } = await this.invoices.statement(p, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.length),
    });
    return new StreamableFile(pdf);
  }
}
