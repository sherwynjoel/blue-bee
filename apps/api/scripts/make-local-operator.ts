/**
 * Creates a dedicated local operator login for console testing, separate from the seeded demo
 * users so their OTP rate-limit budget is never the thing that blocks you. Idempotent.
 * Local only — run against the docker Postgres, never a deployed database.
 */
import { PrismaClient, RoleType, RoleScope, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'a0000000-0000-4000-8000-0000000000ff';
const ROLE_ID = 'a0000000-0000-4000-8000-0000000000fe';
const PHONE = '+14165557777';

async function main(): Promise<void> {
  const db = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(db)) {
    throw new Error(`Refusing to run: DATABASE_URL is not local (${db.slice(0, 40)}…)`);
  }

  await prisma.user.upsert({
    where: { id: USER_ID },
    update: { phone: PHONE, status: UserStatus.ACTIVE },
    create: {
      id: USER_ID,
      orgId: ORG,
      name: 'Local Operator (test)',
      email: 'operator.test@bluebee.local',
      phone: PHONE,
      authProviders: ['phone'],
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.userRole.upsert({
    where: { id: ROLE_ID },
    update: {},
    create: { id: ROLE_ID, orgId: ORG, userId: USER_ID, role: RoleType.OWNER, scope: RoleScope.ORG, createdBy: USER_ID },
  });

  const roles = await prisma.userRole.findMany({ where: { userId: USER_ID }, select: { role: true, scope: true } });
  console.log(`operator ready → phone ${PHONE}  roles=${roles.map((r) => `${r.role}/${r.scope}`).join(',')}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
