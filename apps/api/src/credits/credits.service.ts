import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CREDIT_ERRORS,
  type CreditBalanceView,
  type CreditEntryView,
  type ReferralRewardTerms,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';

/** Where the founder's funded referral reward lives, inside `Organization.settings` JSON. */
const REWARD_SETTING_KEY = 'referralRewardAmount';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * [Inc-37] The customer CREDIT LEDGER — the referral reward Inc-34 deliberately deferred, now real.
 *
 * This is money, so the rules are structural, not conventional:
 *
 *  • **Append-only + signed.** Nothing is ever updated or deleted. `balance` is ALWAYS recomputed as
 *    `SUM(amount)`; there is no stored counter that can drift from the truth. A correction is a NEW entry.
 *
 *  • **The DB prevents double-spend/double-grant, not the code.** `@@unique([orgId, kind, referredUserId])`
 *    and `@@unique([orgId, kind, orderId])` mean a retried delivery hook or a retried PaymentIntent
 *    physically cannot write a second grant/redemption. We catch P2002 and treat it as "already done".
 *
 *  • **No reward until the founder funds one.** `rewardTerms()` reads the amount from org settings; unset or
 *    0 ⇒ `enabled: false`, nothing is ever granted, and the app is contractually required to promise nothing
 *    (that is what keeps Inc-34's honesty firewall intact).
 *
 *  • **Credit can never go negative.** Redemption is capped at the live balance; a console deduction that
 *    would overdraw is refused.
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────── reward terms (founder-funded) ─────────────────────────────

  /**
   * The live referral-reward terms for an org. THE source of truth the app renders its reward copy from —
   * so a promise can never outrun the ledger. Unset/0/invalid ⇒ disabled (promise nothing).
   */
  async rewardTerms(orgId: string, db: Db = this.prisma): Promise<ReferralRewardTerms> {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const raw = (org?.settings as Record<string, unknown> | null)?.[REWARD_SETTING_KEY];
    const amount = typeof raw === 'number' ? raw : Number(raw);
    const enabled = Number.isFinite(amount) && amount > 0;
    return {
      enabled,
      amount: enabled ? amount.toFixed(2) : null,
      currency: 'CAD',
      earnedWhen: 'referred_friend_first_order_delivered',
    };
  }

  /** Console: fund (or switch off) the referral reward. `null`/0 turns it OFF — no reward, no promise. */
  async setReferralReward(principal: RequestPrincipal, amount: number | null): Promise<ReferralRewardTerms> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: principal.orgId }, select: { settings: true } });
    const settings = { ...((org.settings as Record<string, unknown> | null) ?? {}) };
    if (amount == null || amount <= 0) delete settings[REWARD_SETTING_KEY];
    else settings[REWARD_SETTING_KEY] = amount;
    await this.prisma.organization.update({
      where: { id: principal.orgId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    return this.rewardTerms(principal.orgId);
  }

  // ───────────────────────────── balance + ledger ─────────────────────────────

  /** `SUM(amount)` — the ONLY definition of a balance. Never a stored counter. */
  async balanceOf(userId: string, orgId: string, db: Db = this.prisma): Promise<Prisma.Decimal> {
    const agg = await db.creditEntry.aggregate({ where: { userId, orgId }, _sum: { amount: true } });
    return agg._sum.amount ?? new Prisma.Decimal(0);
  }

  /** The customer's balance + their full ledger (self-scoped by the caller). */
  async ledgerFor(userId: string, orgId: string): Promise<CreditBalanceView> {
    const [balance, rows] = await Promise.all([
      this.balanceOf(userId, orgId),
      this.prisma.creditEntry.findMany({
        where: { userId, orgId },
        orderBy: { createdAt: 'desc' },
        include: { referredUser: { select: { name: true } } },
      }),
    ]);
    return {
      balance: balance.toFixed(2),
      currency: 'CAD',
      entries: rows.map((r): CreditEntryView => ({
        id: r.id,
        kind: r.kind,
        amount: r.amount.toFixed(2),
        currency: r.currency,
        orderId: r.orderId,
        referredName: r.referredUser?.name ?? null,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ───────────────────────────── EARN (the referral grant) ─────────────────────────────

  /**
   * The DELIVERED hook's entry point: an order just reached DELIVERED — if the customer who booked it was
   * referred by someone, pay that referrer (once, ever). `Order.createdBy` is the booking customer (the same
   * column Inc-27's "booked by this customer" is derived from); a staff-booked or legacy order with no
   * `createdBy` simply earns nobody anything. Never throws.
   */
  async grantReferralForDeliveredOrder(orgId: string, orderId: string): Promise<{ granted: boolean; amount?: string }> {
    try {
      const order = await this.prisma.order.findFirst({ where: { id: orderId, orgId }, select: { createdBy: true } });
      if (!order?.createdBy) return { granted: false }; // nobody identifiable booked it
      return await this.grantReferralOnFirstDelivery(orgId, order.createdBy, orderId);
    } catch (e) {
      this.logger.error(`Referral credit hook failed for order=${orderId}: ${(e as Error).message}`);
      return { granted: false };
    }
  }

  /**
   * Grant the REFERRER their reward because `referredUserId`'s first order was DELIVERED.
   *
   * Deliberately **never throws** — a credit hiccup must not fail a delivery. Every not-grantable case is a
   * silent no-op:
   *   • no reward funded by the founder        → nothing (and so the app promises nothing)
   *   • the delivered customer wasn't referred  → nothing
   *   • this friend already earned a grant      → nothing
   *
   * "FIRST delivered order" needs no explicit check: the grant is keyed on the FRIEND (unique index on
   * `[orgId, kind, referredUserId]`), so however many orders they go on to have, the referrer is paid exactly
   * once — the first delivery wins and every later one is a no-op.
   */
  async grantReferralOnFirstDelivery(orgId: string, referredUserId: string, orderId: string): Promise<{ granted: boolean; amount?: string }> {
    try {
      const terms = await this.rewardTerms(orgId);
      if (!terms.enabled || !terms.amount) return { granted: false };

      const referred = await this.prisma.user.findFirst({
        where: { id: referredUserId, orgId },
        select: { id: true, referredByUserId: true },
      });
      // Not referred by anyone ⇒ nobody to pay.
      if (!referred?.referredByUserId) return { granted: false };

      // The grant is for the referrer, keyed on the FRIEND — so it can only ever happen once per friend,
      // however many orders they go on to have. (The unique index below is the real enforcement; this
      // read just avoids the pointless write.)
      const already = await this.prisma.creditEntry.findFirst({
        where: { orgId, kind: 'REFERRAL_EARN', referredUserId },
        select: { id: true },
      });
      if (already) return { granted: false };

      await this.prisma.creditEntry.create({
        data: {
          orgId,
          userId: referred.referredByUserId, // the REFERRER is paid
          kind: 'REFERRAL_EARN',
          amount: new Prisma.Decimal(terms.amount),
          currency: terms.currency,
          referredUserId,
          orderId, // provenance: the delivery that earned it
          note: 'Referral reward — a friend you invited had their first order delivered',
        },
      });
      this.logger.log(`Referral credit ${terms.amount} ${terms.currency} granted to ${referred.referredByUserId} (friend ${referredUserId} first delivery)`);
      return { granted: true, amount: terms.amount };
    } catch (e) {
      // A concurrent delivery hook lost the race on the unique index → already granted. Anything else is
      // logged and swallowed: a credit problem must NEVER fail a delivery.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { granted: false };
      this.logger.error(`Referral credit grant failed for referred=${referredUserId}: ${(e as Error).message}`);
      return { granted: false };
    }
  }

  // ───────────────────────────── SPEND (redemption at payment) ─────────────────────────────

  /**
   * Apply the customer's available credit to an order, returning how much was applied. Idempotent per order:
   * the DB allows exactly ONE redemption row per order, so a retried PaymentIntent reuses the SAME amount
   * rather than spending the credit twice.
   *
   * Capped at the live balance AND at the order total, so a balance can never go negative and we never
   * "apply" more than the bill.
   */
  async redeemForOrder(
    orgId: string,
    userId: string,
    orderId: string,
    orderTotal: Prisma.Decimal,
    db: Db = this.prisma,
  ): Promise<Prisma.Decimal> {
    // Already redeemed on this order (a retry)? Reuse it — never spend twice.
    const existing = await db.creditEntry.findFirst({
      where: { orgId, kind: 'REDEMPTION', orderId },
      select: { amount: true },
    });
    if (existing) return existing.amount.negated(); // stored negative; report the positive amount applied

    const balance = await this.balanceOf(userId, orgId, db);
    if (balance.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);

    const applied = Prisma.Decimal.min(balance, orderTotal);
    if (applied.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);

    try {
      await db.creditEntry.create({
        data: {
          orgId,
          userId,
          kind: 'REDEMPTION',
          amount: applied.negated(), // SPEND ⇒ negative
          currency: 'CAD',
          orderId,
          note: 'Credit applied to this order',
        },
      });
    } catch (e) {
      // Lost a race with a concurrent PaymentIntent for the same order → read back what the winner applied.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await db.creditEntry.findFirst({ where: { orgId, kind: 'REDEMPTION', orderId }, select: { amount: true } });
        return winner ? winner.amount.negated() : new Prisma.Decimal(0);
      }
      throw e;
    }
    return applied;
  }

  // ───────────────────────────── console adjustment ─────────────────────────────

  /**
   * Manual grant/deduction by an OWNER/FINANCE, with a mandatory note. This is also how a voided order's
   * credit is returned. A deduction that would overdraw the balance is REFUSED (a balance can't go negative).
   */
  async adjust(principal: RequestPrincipal, userId: string, amount: number, note: string): Promise<CreditBalanceView> {
    const dec = new Prisma.Decimal(amount.toFixed(2));
    if (dec.isNegative()) {
      const balance = await this.balanceOf(userId, principal.orgId);
      if (balance.plus(dec).isNegative()) {
        throw new BadRequestException({
          error: CREDIT_ERRORS.INSUFFICIENT_BALANCE,
          message: `That deduction would overdraw the balance (available ${balance.toFixed(2)}).`,
        });
      }
    }
    await this.prisma.creditEntry.create({
      data: {
        orgId: principal.orgId,
        userId,
        kind: 'ADJUSTMENT',
        amount: dec,
        currency: 'CAD',
        note,
        createdBy: principal.userId,
      },
    });
    return this.ledgerFor(userId, principal.orgId);
  }
}
