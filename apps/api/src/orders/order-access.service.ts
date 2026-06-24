import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Item, Order } from '@prisma/client';
import { ORDER_ERRORS } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';

/**
 * Centralized parent-ownership gate (closes the Increment-2 carried-forward hole).
 *
 * The scoped Prisma client forces a row's OWN `org_id` and validates account-DIRECT
 * writes, but it does NOT stop a child row (OrderLine/Item/Inspection/Photo/Quote/
 * CustodyEvent) being mis-parented to an Order in ANOTHER account within the same org.
 * Increment 3 introduces those child writes, so EVERY child write first verifies the
 * parent Order's ownership here — org always, plus account/site for confined principals —
 * before the write. One helper, not scattered per-handler checks.
 *
 * Semantics: load the parent through the SCOPED client (which enforces org + account/
 * site). If visible → in scope, proceed. If not → distinguish 403 (exists in the org
 * but a different account — cross-account) from 404 (different org / nonexistent).
 */
@Injectable()
export class OrderAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** A row-scoped client for the principal (use for all reads: get/list). */
  scopedFor(principal: RequestPrincipal) {
    return scopedPrisma(this.prisma, principal);
  }

  /**
   * Resolve the parent Order for a WRITE, enforcing ownership. Returns the order or
   * throws 403 (cross-account-within-org) / 404 (cross-org / nonexistent).
   */
  async requireOrderForWrite(principal: RequestPrincipal, orderId: string): Promise<Order> {
    const scoped = await this.scopedFor(principal).order.findUnique({ where: { id: orderId } });
    if (scoped) return scoped;

    // Not visible under the principal's scope — decide between 403 and 404 without leaking
    // cross-org existence: only look inside the principal's OWN org.
    const inOrg = await this.prisma.order.findFirst({ where: { id: orderId, orgId: principal.orgId } });
    if (inOrg) {
      throw new ForbiddenException({
        error: ORDER_ERRORS.CROSS_ACCOUNT_FORBIDDEN,
        message: 'Order belongs to a different account in your organization',
      });
    }
    throw new NotFoundException({ error: ORDER_ERRORS.ORDER_NOT_FOUND, message: `Order ${orderId} not found` });
  }

  /**
   * Resolve a child Item under a given Order for a WRITE, enforcing parent ownership AND
   * that the item actually belongs to that order. Returns { order, item }.
   */
  async requireItemForWrite(
    principal: RequestPrincipal,
    orderId: string,
    itemId: string,
  ): Promise<{ order: Order; item: Item }> {
    const order = await this.requireOrderForWrite(principal, orderId);
    // Item read through the scoped client too (defense in depth — enforces account VIA order).
    const item = await this.scopedFor(principal).item.findUnique({ where: { id: itemId } });
    if (!item || item.orderId !== orderId) {
      throw new NotFoundException({
        error: ORDER_ERRORS.ITEM_NOT_FOUND,
        message: `Item ${itemId} not found on order ${orderId}`,
      });
    }
    return { order, item };
  }

  /** Read a single order under scope (for GET); 404 if not visible to the principal. */
  async getOrderForRead(principal: RequestPrincipal, orderId: string): Promise<Order> {
    const order = await this.scopedFor(principal).order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException({ error: ORDER_ERRORS.ORDER_NOT_FOUND, message: `Order ${orderId} not found` });
    }
    return order;
  }
}
