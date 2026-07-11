import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Rating } from '@prisma/client';
import {
  OrderStatus,
  RATING_EDIT_WINDOW_DAYS,
  RATING_ERRORS,
  isOrderRateable,
  type CreateRatingDto,
  type PatchRatingDto,
  type RatingView,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { OrderAccessService } from '../orders/order-access.service';

const EDIT_WINDOW_MS = RATING_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * [Inc-32] Post-delivery ratings / CSAT. One order-level rating per order (1–5 + optional comment),
 * written by the order's customer-side principal once the order has reached DELIVERED (delivered-or-later).
 * Scope/ownership is the SAME proven `requireOrderForWrite` gate the rest of the order surface uses:
 * a customer resolves only their own account's order (cross-account → 403, cross-org/nonexistent → 404),
 * so a customer can only ever rate an order they own. Uniqueness is DB-enforced (`@@unique`); the original
 * submitter may revise within `RATING_EDIT_WINDOW_DAYS`.
 */
@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
  ) {}

  /** Create the order's rating (owning customer only; order delivered-or-later; one per order → 409). */
  async create(principal: RequestPrincipal, orderId: string, dto: CreateRatingDto): Promise<RatingView> {
    const order = await this.access.requireOrderForWrite(principal, orderId); // 403 cross-account / 404 cross-org
    this.assertRateable(order.status as unknown as OrderStatus);
    try {
      const rating = await this.prisma.rating.create({
        data: {
          orgId: order.orgId,
          orderId,
          score: dto.score,
          comment: normalizeComment(dto.comment),
          submittedByUserId: principal.userId,
          createdBy: principal.userId,
        },
      });
      return this.toView(rating);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ error: RATING_ERRORS.RATING_ALREADY_EXISTS, message: `Order ${orderId} is already rated` });
      }
      throw e;
    }
  }

  /** Revise the order's rating — the ORIGINAL submitter only, within the edit window. */
  async update(principal: RequestPrincipal, orderId: string, dto: PatchRatingDto): Promise<RatingView> {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    const rating = await this.loadOwn(order.orgId, orderId);
    if (rating.submittedByUserId !== principal.userId) {
      throw new ForbiddenException({ error: RATING_ERRORS.RATING_NOT_YOURS, message: 'only the original submitter may revise this rating' });
    }
    if (!this.withinEditWindow(rating.createdAt)) {
      throw new ConflictException({ error: RATING_ERRORS.EDIT_WINDOW_CLOSED, message: `a rating is immutable after ${RATING_EDIT_WINDOW_DAYS} days` });
    }
    const updated = await this.prisma.rating.update({
      where: { orderId },
      data: {
        ...(dto.score !== undefined ? { score: dto.score } : {}),
        ...(dto.comment !== undefined ? { comment: normalizeComment(dto.comment) } : {}),
      },
    });
    return this.toView(updated);
  }

  /** Read the order's rating (owning customer for their order; OWNER/CSR for the console). 404 if none. */
  async get(principal: RequestPrincipal, orderId: string): Promise<RatingView> {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    return this.toView(await this.loadOwn(order.orgId, orderId));
  }

  private async loadOwn(orgId: string, orderId: string): Promise<Rating> {
    const rating = await this.prisma.rating.findUnique({ where: { orderId } });
    if (!rating || rating.orgId !== orgId) {
      throw new NotFoundException({ error: RATING_ERRORS.RATING_NOT_FOUND, message: `Order ${orderId} has no rating` });
    }
    return rating;
  }

  private assertRateable(status: OrderStatus): void {
    if (!isOrderRateable(status)) {
      throw new ConflictException({ error: RATING_ERRORS.ORDER_NOT_RATEABLE, message: `Order is not rateable in status ${status} — rate it after delivery` });
    }
  }

  private withinEditWindow(createdAt: Date): boolean {
    return Date.now() - createdAt.getTime() <= EDIT_WINDOW_MS;
  }

  private toView(r: Rating): RatingView {
    return {
      id: r.id,
      orderId: r.orderId,
      score: r.score,
      comment: r.comment,
      submittedByUserId: r.submittedByUserId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      editable: this.withinEditWindow(r.createdAt),
    };
  }
}

/** Trim to a non-empty comment or null (an empty/whitespace comment is "no comment", never ""). */
function normalizeComment(comment: string | null | undefined): string | null {
  const t = comment?.trim();
  return t && t.length > 0 ? t : null;
}
