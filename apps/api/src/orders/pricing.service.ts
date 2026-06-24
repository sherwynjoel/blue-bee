import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Where a resolved rate came from (audited on the quote line for transparency). */
export type RateSource = 'account_override' | 'account_list' | 'default_list' | 'service_base';

export interface ResolvedRate {
  rate: number;
  source: RateSource;
  unit: string;
  serviceName: string;
}

/**
 * Pricing resolution (PRD §8.3, §9.2). Resolves a per-service rate in priority order:
 *   1. account-specific PriceListItem.account_override
 *   2. account-specific PriceListItem.rate
 *   3. org-default (account_id NULL) PriceListItem.rate
 *   4. Service.base_rate (fallback)
 * and resolves the HST rate from org billing config (not a scattered literal), so
 * Stripe Tax can replace it later.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** HST rate from Organization.billing_config.taxRate → env TAX_RATE_HST → 0.13 (Ontario). */
  resolveTaxRate(org: { billingConfig: unknown }): number {
    const cfg = (org.billingConfig ?? {}) as Record<string, unknown>;
    const fromOrg = typeof cfg.taxRate === 'number' ? cfg.taxRate : undefined;
    const envRaw = process.env.TAX_RATE_HST;
    const fromEnv = envRaw !== undefined && envRaw !== '' ? Number(envRaw) : undefined;
    const rate = fromOrg ?? (fromEnv !== undefined && Number.isFinite(fromEnv) ? fromEnv : undefined) ?? 0.13;
    if (!(rate >= 0 && rate < 1)) {
      throw new Error(`Configured tax rate ${rate} is out of range [0,1)`);
    }
    return rate;
  }

  /** Resolve the effective rate for (org, account, service). Throws if the service is missing. */
  async resolveRate(orgId: string, accountId: string, serviceId: string): Promise<ResolvedRate> {
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, orgId } });
    if (!service) {
      throw new Error(`service ${serviceId} not found in org`);
    }
    const items = await this.prisma.priceListItem.findMany({
      where: {
        orgId,
        serviceId,
        priceList: { active: true, OR: [{ accountId }, { accountId: null }] },
      },
      include: { priceList: { select: { accountId: true } } },
    });

    const accountItem = items.find((i) => i.priceList.accountId === accountId);
    if (accountItem) {
      if (accountItem.accountOverride !== null) {
        return { rate: Number(accountItem.accountOverride), source: 'account_override', unit: service.unit, serviceName: service.name };
      }
      return { rate: Number(accountItem.rate), source: 'account_list', unit: service.unit, serviceName: service.name };
    }
    const defaultItem = items.find((i) => i.priceList.accountId === null);
    if (defaultItem) {
      return { rate: Number(defaultItem.rate), source: 'default_list', unit: service.unit, serviceName: service.name };
    }
    return { rate: Number(service.baseRate), source: 'service_base', unit: service.unit, serviceName: service.name };
  }
}
