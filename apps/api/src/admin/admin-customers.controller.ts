import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RoleType, listCustomersQuerySchema, type ListCustomersQuery } from '@blue-bee/shared';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import { ZodBody } from '../common/zod-validation.pipe';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AdminCustomersService } from './admin-customers.service';

/**
 * Console customer-360 (Increment 27) — read-only, org-scoped, **OWNER/CSR-gated**.
 *
 * Deliberately its own controller rather than three more methods on `AdminController`: that class carries a
 * class-level `@Roles(OWNER)`, and although `RolesGuard` uses `getAllAndOverride` (so a method-level
 * `@Roles` would win), relying on that override for a widened PII gate is exactly the kind of thing that
 * breaks silently when someone reorders decorators. A separate class states the gate once, at the top.
 * Both classes mount on `/v1/admin` with non-overlapping paths.
 *
 * CSR is included because customer support is the whole point of this view; every other admin route stays
 * OWNER-only. Reading one customer's 360 writes an `AuditLog` row (`CUSTOMER_360_VIEWED`) — staff viewing
 * consumer PII is accountable (§8.7).
 *
 * Read-only v1: no staff edits of a customer's contact details or addresses. That is a follow-up.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(RoleType.OWNER, RoleType.CSR)
@Controller('admin')
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @Get('customers')
  @ApiOperation({
    summary:
      'List residential customers (users holding RESIDENTIAL_CUSTOMER), cursor-paginated and searchable by name / phone / email. OWNER or CSR.',
  })
  @ApiQuery({ name: 'search', required: false, description: 'Case-insensitive substring of name, phone or email.' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (default 25, max 100).' })
  // The shared Zod schema coerces + bounds `limit` and rejects a malformed cursor, so a bad page request
  // is a 400 rather than an unbounded scan.
  list(@CurrentUser() p: RequestPrincipal, @Query(new ZodBody(listCustomersQuerySchema)) query: ListCustomersQuery) {
    return this.customers.listCustomers(p, query);
  }

  @Get('customers/:id')
  @ApiOperation({
    summary:
      "One residential customer's 360: identity, saved addresses (+ coverage), account order history, invoices/payments, devices, memberships. Audited PII access. A staff id or a cross-org id → 404.",
  })
  get(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.getCustomer360(p, id);
  }
}
