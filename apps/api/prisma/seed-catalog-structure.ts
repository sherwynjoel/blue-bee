/**
 * [Inc-25] STRUCTURE-ONLY catalog seed — the production entrypoint.
 *
 * Seeds ONLY the catalog skeleton into the resolved org:
 *   • the 8 top-level service cards — `priceFrom = NULL`, NO backing rate `Service`
 *   • the 3 garment categories (Shirts / Outerwear / Formalwear) nested under the Dry Cleaning card
 *
 * It seeds NO items, NO prices and writes NOTHING to S3 (honesty firewall). The founder enters real CAD
 * rates and adds real garment items via the `/catalog` console.
 *
 * The org is RESOLVED, never hardcoded (this is the Inc-25 bug fix): an explicit `SEED_ORG_ID` wins,
 * otherwise the single `Organization` in the database is used, and if several exist it REFUSES to guess.
 * `SEED_OWNER_ID` may pin `createdBy`; otherwise the org's OWNER grant is used.
 *
 * Idempotent — re-running upserts the same deterministic rows. NOTE: the upsert re-asserts `sortOrder`,
 * so a re-run resets a console reorder. Reorder AFTER seeding, not before.
 *
 * Run (prod, inside the api container — the runtime image ships `prisma/` + `ts-node` but NOT a tsconfig,
 * hence the explicit compiler options, mirroring bootstrap.ts):
 *
 *   railway ssh --service api
 *   cd /app/apps/api
 *   SEED_ORG_ID=<uuid> npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     prisma/seed-catalog-structure.ts
 *
 * Or locally, from apps/api:  npm run db:seed:catalog
 */
import { PrismaClient } from '@prisma/client';
import { seedDrycleanCatalog } from './seed-catalog';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    if (process.env.SEED_SAMPLE_ITEMS === '1') {
      throw new Error('[seed-catalog-structure] SEED_SAMPLE_ITEMS=1 is refused here — this entrypoint is structure-only.');
    }
    // sampleItems: false is explicit, so this can never ship a sample price even if the env changes.
    await seedDrycleanCatalog(prisma, { sampleItems: false });
    console.log('[seed] structure-only catalog seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
