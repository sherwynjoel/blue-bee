import { PricingAccountService } from './pricing-account.service';

/**
 * Unit coverage for the effective-pricing-account PRECEDENCE + the self-reference guard (the branches the
 * PostGIS e2e doesn't isolate): building match wins over membership; a match equal to the payer is ignored;
 * membership is the fallback; nothing matched ⇒ null. The geo query + membership read are stubbed (the real
 * PostGIS `ST_DWithin` match is proven end-to-end in `test/corporate-pricing.e2e-spec.ts`).
 */
describe('PricingAccountService — effective pricing account precedence', () => {
  const ORG = 'org-1';
  const USER = 'user-1';
  const PAYER = 'payer-acct';
  const CORP_BUILDING = 'corp-building-acct';
  const CORP_MEMBERSHIP = 'corp-membership-acct';

  function make(buildingRows: Array<{ account_id: string }>, membershipAccountId: string | null) {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(buildingRows),
      corporateMembership: {
        findFirst: jest.fn().mockResolvedValue(membershipAccountId ? { accountId: membershipAccountId } : null),
      },
    };
    return { svc: new PricingAccountService(prisma as never), prisma };
  }

  it('building match wins over membership when both resolve', async () => {
    const { svc, prisma } = make([{ account_id: CORP_BUILDING }], CORP_MEMBERSHIP);
    const res = await svc.resolveForBooking({ orgId: ORG, userId: USER, payerAccountId: PAYER, serviceGeo: { lat: 43.6, lng: -79.4 } });
    expect(res).toEqual({ pricingAccountId: CORP_BUILDING, source: 'building_match' });
    // membership is never consulted once a building matched.
    expect(prisma.corporateMembership.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to membership when there is no service point', async () => {
    const { svc, prisma } = make([], CORP_MEMBERSHIP);
    const res = await svc.resolveForBooking({ orgId: ORG, userId: USER, payerAccountId: PAYER });
    expect(res).toEqual({ pricingAccountId: CORP_MEMBERSHIP, source: 'membership' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled(); // no geo ⇒ no building query
  });

  it('a building match equal to the payer is ignored (then membership is tried)', async () => {
    const { svc } = make([{ account_id: PAYER }], CORP_MEMBERSHIP);
    const res = await svc.resolveForBooking({ orgId: ORG, userId: USER, payerAccountId: PAYER, serviceGeo: { lat: 43.6, lng: -79.4 } });
    expect(res).toEqual({ pricingAccountId: CORP_MEMBERSHIP, source: 'membership' });
  });

  it('a membership equal to the payer is ignored ⇒ null', async () => {
    const { svc } = make([], PAYER);
    const res = await svc.resolveForBooking({ orgId: ORG, userId: USER, payerAccountId: PAYER });
    expect(res).toBeNull();
  });

  it('nothing matched ⇒ null (default/residential pricing)', async () => {
    const { svc } = make([], null);
    const res = await svc.resolveForBooking({ orgId: ORG, userId: USER, payerAccountId: PAYER, serviceGeo: { lat: 1, lng: 1 } });
    expect(res).toBeNull();
  });
});
