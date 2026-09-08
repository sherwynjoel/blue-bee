import { RoleType } from '@blue-bee/shared';
import { PrincipalService } from './principal.service';
import { PrismaService } from '../prisma/prisma.service';

// Defensive org-scoping (Step 2 hardening): `loadGrants(userId, orgId?)` — `orgId` is optional and,
// today, redundant (userId already uniquely identifies a user in exactly one org), but a mismatched
// orgId must still yield zero grants once passed, not the user's real-org roles.
const REAL_ORG = 'org-real';
const OTHER_ORG = 'org-other';
const USER_ID = 'user-1';

const SEEDED_ROLES = [{ id: 'r1', orgId: REAL_ORG, userId: USER_ID, role: 'OWNER', scope: 'ORG', scopeId: null }];

function makeService() {
  // Mimics Postgres WHERE semantics: filters by userId always, and by orgId only when provided.
  const findMany = jest.fn(async (args: { where: { userId: string; orgId?: string } }) =>
    SEEDED_ROLES.filter(
      (r) => r.userId === args.where.userId && (args.where.orgId === undefined || r.orgId === args.where.orgId),
    ),
  );
  const prisma = { userRole: { findMany } } as unknown as PrismaService;
  return { svc: new PrincipalService(prisma), findMany };
}

describe('PrincipalService.loadGrants — defensive org-scoping', () => {
  it('returns the roles when no orgId is passed (unscoped — existing call sites keep working)', async () => {
    const { svc } = makeService();
    const roles = await svc.loadGrants(USER_ID);
    expect(roles).toHaveLength(1);
    expect(roles[0].role).toBe(RoleType.OWNER);
  });

  it('returns the roles when the correct orgId is passed', async () => {
    const { svc } = makeService();
    const roles = await svc.loadGrants(USER_ID, REAL_ORG);
    expect(roles).toHaveLength(1);
  });

  it('returns an empty array for a mismatched orgId, even though the user has real roles in their actual org', async () => {
    const { svc, findMany } = makeService();
    const roles = await svc.loadGrants(USER_ID, OTHER_ORG);
    expect(roles).toEqual([]);
    expect(findMany).toHaveBeenCalledWith({ where: { userId: USER_ID, orgId: OTHER_ORG } });
  });
});
