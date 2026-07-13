import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  adjustCreditSchema,
  setReferralRewardSchema,
  type AdjustCreditDto,
  type CreditBalanceView,
  type ReferralRewardTerms,
  type SetReferralRewardDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { CreditsService } from './credits.service';

/**
 * [Inc-37] The customer's OWN credit balance + ledger. Self-scoped (always `principal.userId`, never a
 * client-supplied id), so no `@Roles` beyond auth — exactly like the account/referral surfaces.
 */
@ApiTags('account')
@ApiBearerAuth()
@Controller('account')
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get('credits')
  @ApiOperation({ summary: "The signed-in customer's REAL credit balance (SUM of an append-only ledger) + every entry." })
  getCredits(@CurrentUser() p: RequestPrincipal): Promise<CreditBalanceView> {
    return this.credits.ledgerFor(p.userId, p.orgId);
  }
}

/**
 * [Inc-37] Console credit control — OWNER/FINANCE only, because this is MONEY:
 *   • read any customer's ledger,
 *   • grant/deduct manually (a note is mandatory; a deduction can never overdraw),
 *   • fund (or switch OFF) the referral reward — 0/null means NO reward exists, and the app then promises
 *     nothing at all (that is what keeps the honesty firewall intact).
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(RoleType.OWNER, RoleType.FINANCE)
@Controller('admin')
export class CreditsAdminController {
  constructor(private readonly credits: CreditsService) {}

  @Get('referral-reward')
  @ApiOperation({ summary: 'The live referral reward terms (enabled/amount). Disabled ⇒ nothing is granted and the app promises nothing.' })
  getReward(@CurrentUser() p: RequestPrincipal): Promise<ReferralRewardTerms> {
    return this.credits.rewardTerms(p.orgId);
  }

  @Put('referral-reward')
  @ApiOperation({ summary: 'Fund the referral reward (amount a referrer earns when their friend’s FIRST order is DELIVERED). null/0 turns it OFF.' })
  setReward(
    @CurrentUser() p: RequestPrincipal,
    @Body(new ZodBody(setReferralRewardSchema)) dto: SetReferralRewardDto,
  ): Promise<ReferralRewardTerms> {
    return this.credits.setReferralReward(p, dto.amount);
  }

  @Get('customers/:id/credits')
  @ApiOperation({ summary: "A customer's credit balance + full ledger (console customer-360)." })
  getCustomerCredits(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<CreditBalanceView> {
    return this.credits.ledgerFor(id, p.orgId);
  }

  @Post('customers/:id/credits/adjust')
  @ApiOperation({ summary: 'Manually grant (+) or deduct (−) credit, with a mandatory note. Appends an immutable entry; never overdraws.' })
  adjust(
    @CurrentUser() p: RequestPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBody(adjustCreditSchema)) dto: AdjustCreditDto,
  ): Promise<CreditBalanceView> {
    return this.credits.adjust(p, id, dto.amount, dto.note);
  }
}
