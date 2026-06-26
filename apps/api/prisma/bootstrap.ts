/**
 * Blue Bee — minimal PRODUCTION bootstrap (Increment 14b).
 *
 * The demo `seed.ts` is FORBIDDEN against a production database (it inserts a fabricated demo order +
 * account + tags). This script instead provisions only the irreducible real-org root needed to operate
 * the platform: ONE Organization (the anchor client) + ONE owner User (phone-OTP login) + that user's
 * OWNER role. Nothing fabricated (honesty firewall, CLAUDE.md) — every field comes from the founder's
 * env input, and there is NO demo account/site/order/tag.
 *
 * Idempotent + prod-safe: a re-run with the SAME phone is a no-op; and because this is the single
 * anchor org, it REFUSES to create a second org if one already exists (re-target in place instead).
 *
 * Run (locally against the Railway DB over its public proxy, or inside the API container):
 *   BOOTSTRAP_ORG_NAME="…" BOOTSTRAP_OWNER_NAME="…" BOOTSTRAP_OWNER_PHONE="+1416…" \
 *   BOOTSTRAP_OWNER_EMAIL="owner@…" DATABASE_URL="postgresql://…" \
 *   npx ts-node prisma/bootstrap.ts
 *
 * Working folder: "/Volumes/Gowtham/Blue Bee".
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { RoleScope, RoleType, UserStatus } from '@blue-bee/shared';

const prisma = new PrismaClient();

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var ${name} (the real-org bootstrap needs it — no defaults so nothing is fabricated)`);
  }
  return v.trim();
}

function optEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v.trim() : fallback;
}

async function main(): Promise<void> {
  const orgName = reqEnv('BOOTSTRAP_ORG_NAME');
  const ownerName = reqEnv('BOOTSTRAP_OWNER_NAME');
  const ownerPhone = reqEnv('BOOTSTRAP_OWNER_PHONE');
  const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL?.trim() || null;

  // E.164-ish: a '+' and 8–15 digits. The OTP login resolves the user by exact phone, so this must
  // be the precise number the owner will enter.
  if (!/^\+\d{8,15}$/.test(ownerPhone)) {
    throw new Error(`BOOTSTRAP_OWNER_PHONE must be E.164 (e.g. +14165551234); got "${ownerPhone}"`);
  }

  const tz = optEnv('BOOTSTRAP_ORG_TZ', 'America/Toronto');
  const currency = optEnv('BOOTSTRAP_ORG_CURRENCY', 'CAD');
  const taxRate = Number(optEnv('BOOTSTRAP_TAX_RATE', '0.13'));
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
    throw new Error(`BOOTSTRAP_TAX_RATE must be a fraction between 0 and 1 (e.g. 0.13 for 13% HST); got "${process.env.BOOTSTRAP_TAX_RATE}"`);
  }

  // Idempotency: a re-run with the SAME owner phone is a no-op (the login resolves on this phone).
  const existing = await prisma.user.findFirst({ where: { phone: ownerPhone, status: 'ACTIVE' } });
  if (existing) {
    console.log(`[bootstrap] An ACTIVE user already exists for ${ownerPhone} (id ${existing.id}, org ${existing.orgId}). No-op.`);
    return;
  }

  // Single-tenant pilot invariant: this script provisions the ONE anchor org. If an org already
  // exists but no ACTIVE owner matches this phone, REFUSE rather than silently double-provision a
  // second org + owner (the original owner would also remain an ACTIVE login). To re-target the
  // pilot to the real client, update the existing org/owner in place (or remove the pilot org
  // first) — see docs/DEPLOY-RAILWAY.md — then this guard is satisfied.
  const orgCount = await prisma.organization.count();
  if (orgCount > 0) {
    throw new Error(
      `An organization already exists, but no ACTIVE owner has phone ${ownerPhone}. This bootstrap ` +
        `creates the single anchor org ONCE and will NOT create a second. To re-target the pilot to the ` +
        `real client, update the existing org/owner in place (or remove the pilot org first). See docs/DEPLOY-RAILWAY.md.`,
    );
  }

  const orgId = randomUUID();
  const ownerId = randomUUID();
  const roleId = randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.organization.create({
      data: {
        id: orgId,
        orgId, // tenant root: org_id == id
        name: orgName,
        settings: { region: 'GTA', currency, tz },
        billingConfig: { taxRate, taxLabel: 'HST (Ontario)' },
        createdBy: ownerId,
      },
    });

    await tx.user.create({
      data: {
        id: ownerId,
        orgId,
        name: ownerName,
        email: ownerEmail,
        phone: ownerPhone,
        authProviders: ['phone'],
        status: UserStatus.ACTIVE,
        createdBy: ownerId,
      },
    });

    await tx.userRole.create({
      data: {
        id: roleId,
        orgId,
        userId: ownerId,
        role: RoleType.OWNER,
        scope: RoleScope.ORG,
        createdBy: ownerId,
      },
    });
  });

  console.log('[bootstrap] Provisioned the anchor org + owner (idempotent):');
  console.log(`  org   id=${orgId} name="${orgName}"`);
  console.log(`  owner id=${ownerId} name="${ownerName}" phone=${ownerPhone} role=OWNER scope=ORG`);
  console.log(`  → log in by requesting an OTP for ${ownerPhone}.`);
}

main()
  .catch((err) => {
    console.error('[bootstrap] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
