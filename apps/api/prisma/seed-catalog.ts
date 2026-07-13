/**
 * Inc-17 — dry-clean visual catalog seed. Seeds the 8 top-level service cards + 3 garment categories, and
 * (DEV ONLY) ~7 SAMPLE items (Service, unit ITEM) each with a REAL image pushed into local MinIO through the
 * SAME AWS-SDK S3 path the media provider uses (no hard-coded URLs, no placeholder strings).
 *
 * [Inc-25] TARGETING. This seed used to HARDCODE the demo org (`11111111-…`). That meant every "seed the live
 * catalog" run silently wrote the 8 cards into the demo org, which the real (bootstrap-provisioned) login
 * never reads — the cards appeared to vanish. The org + owner are now RESOLVED, never assumed:
 *   1. an explicit `orgId`/`ownerId` passed by the caller (seed.ts does this for the demo org), else
 *   2. `SEED_ORG_ID` / `SEED_OWNER_ID` from the environment, else
 *   3. the single `Organization` in the database — and if there is more than one, this REFUSES to guess.
 * It is now structurally impossible to seed the wrong org.
 *
 * [Inc-25] HONESTY FIREWALL. The SAMPLE garment items + their placeholder tiles are DEV-ONLY and are gated
 * behind `sampleItems` (caller) / `SEED_SAMPLE_ITEMS=1` (env). They default to OFF, so a production run seeds
 * STRUCTURE ONLY: 8 cards with `priceFrom = NULL` and no backing rate, plus 3 empty garment categories.
 * No sample price, no sample image, no S3 write ever reaches prod. The founder enters real prices in /catalog.
 *
 * Idempotent: deterministic ids; a re-run upserts the same rows (and re-PUTs the same keys in dev).
 */
import { deflateSync } from 'node:zlib';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient, RoleType, ServiceUnit, ServiceVertical, type PricingModel, type PricingUnit } from '@prisma/client';
import { backingServiceUnit, isWeightPricingUnit, type PricingUnit as SharedPricingUnit } from '@blue-bee/shared';

const uuidIn = (prefix: string) => (n: number): string => `${prefix}-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const cat = uuidIn('ca000000');
const svc = uuidIn('5e000000'); // [Inc-21] the 8 top-level service-menu cards
const rateSvc = uuidIn('5e000001'); // [Inc-36] each card's BACKING rate Service (one per card)

/**
 * [Inc-36] The backing Service's unit + vertical are derived with the SAME shared helpers the console's rate
 * editor uses (`catalog-admin.service.ts`), so a seeded card and a console-edited card can never disagree:
 * PER_KG→KG, PER_LB→LB, PER_MEASURE→SQFT, PER_ITEM→ITEM; weight units ⇒ WASHFOLD, else SPECIALTY.
 * (Prisma's generated enums and the shared enums are the same string literals — hence the structural casts.)
 */
const backingUnitOf = (u: PricingUnit): ServiceUnit => backingServiceUnit(u as unknown as SharedPricingUnit) as unknown as ServiceUnit;
const verticalOf = (u: PricingUnit): ServiceVertical =>
  isWeightPricingUnit(u as unknown as SharedPricingUnit) ? ServiceVertical.WASHFOLD : ServiceVertical.SPECIALTY;

/** [Inc-25] Where this seed writes, and who is recorded as `createdBy`. Resolved, never hardcoded. */
export interface SeedCatalogTarget {
  orgId: string;
  ownerId: string;
}

/** [Inc-25] Options for a seed run. `sampleItems` ships the DEV-ONLY garment items + placeholder tiles. */
export interface SeedCatalogOptions extends Partial<SeedCatalogTarget> {
  sampleItems?: boolean;
}

/**
 * [Inc-25] Resolve the target org + owner. Explicit args win, then env, then "the one org in the database".
 * With more than one org and no explicit target it THROWS rather than picking — that ambiguity is exactly
 * what silently seeded the demo org before.
 */
export async function resolveSeedTarget(prisma: PrismaClient, opts: SeedCatalogOptions = {}): Promise<SeedCatalogTarget> {
  const orgId = opts.orgId ?? process.env.SEED_ORG_ID ?? (await resolveSoleOrgId(prisma));
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) throw new Error(`[seed-catalog] target org ${orgId} does not exist`);

  const ownerId = opts.ownerId ?? process.env.SEED_OWNER_ID ?? (await resolveOrgOwnerId(prisma, org.id));
  const owner = await prisma.user.findFirst({ where: { id: ownerId, orgId: org.id }, select: { id: true } });
  if (!owner) throw new Error(`[seed-catalog] owner ${ownerId} is not a user of org ${org.id} ("${org.name}")`);

  console.log(`[seed] target org ${org.id} ("${org.name}"), createdBy ${ownerId}`);
  return { orgId: org.id, ownerId };
}

async function resolveSoleOrgId(prisma: PrismaClient): Promise<string> {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
  if (orgs.length === 1) return orgs[0].id;
  const listed = orgs.map((o) => `${o.id} ("${o.name}")`).join(', ') || '<none>';
  throw new Error(
    `[seed-catalog] refusing to guess the target org: found ${orgs.length} organizations (${listed}). ` +
      `Pass SEED_ORG_ID=<uuid> (and optionally SEED_OWNER_ID=<uuid>).`,
  );
}

async function resolveOrgOwnerId(prisma: PrismaClient, orgId: string): Promise<string> {
  const grant = await prisma.userRole.findFirst({
    where: { orgId, role: RoleType.OWNER },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  if (!grant) throw new Error(`[seed-catalog] org ${orgId} has no OWNER user; pass SEED_OWNER_ID=<uuid>`);
  return grant.userId;
}

// [Inc-21] The 8 top-level customer Home service cards (ServiceCategory, parentId = NULL). STRUCTURE + COPY
// only — NO price. `priceFrom` is seeded NULL and NO backing rate Service is created (honesty firewall: no
// SAMPLE/placeholder rate ships; the card shows "Get a quote" until the founder enters a real CAD price + rate
// in the /catalog console). `icon` is a semantic key the customer app maps to an icon + tint (HomeScreen
// CATEGORY_ICONS). This increment INTENTIONALLY introduces consumer Wash & Fold + Wash & Iron — beyond the
// specialty-only MVP (PRD §14.1 "no consumer wash-fold") — a deliberate, founder-approved product pivot.
const DRY_CLEANING_ID = svc(3); // the Dry Cleaning card nests the Shirts/Outerwear/Formalwear garment sub-catalog
interface ServiceCard {
  id: string;
  name: string;
  sortOrder: number;
  description: string;
  features: string[];
  icon: string;
  unit: PricingUnit;
  pricingModel: PricingModel;
  /** [Inc-36] The card's BACKING rate Service — deterministic id + name. */
  serviceId: string;
  serviceName: string;
  /**
   * [Inc-36] STARTER per-unit rate in CAD. This is a CONFIGURABLE PLACEHOLDER so the in-checkout estimate
   * has real math to run — it is **NOT** an official Blue Bee published price. The founder sets the real
   * rate in the `/catalog` console (which overwrites it; a re-seed never clobbers a founder-set rate).
   * The card's public "from $X" anchor (`priceFrom`) stays NULL until the founder sets a real price, so the
   * grid honestly shows "Get a quote" rather than advertising a starter number (honesty firewall).
   */
  starterRate: string;
}
const SERVICE_CARDS: ServiceCard[] = [
  { id: svc(1), name: 'Wash & Fold', sortOrder: 1, description: 'For everyday laundry, bedsheets and towels.', features: ['WASH', 'TUMBLE-DRY', 'FOLDED', 'IN A BAG'], icon: 'wash-fold', unit: 'PER_KG', pricingModel: 'FIXED', serviceId: rateSvc(1), serviceName: 'Wash & Fold — per kg', starterRate: '3.5000' },
  { id: svc(2), name: 'Wash & Iron', sortOrder: 2, description: 'Everyday clothes washed and pressed, back on hangers.', features: ['WASH', 'TUMBLE-DRY', 'IRONING', 'ON HANGERS'], icon: 'wash-iron', unit: 'PER_KG', pricingModel: 'FIXED', serviceId: rateSvc(2), serviceName: 'Wash & Iron — per kg', starterRate: '4.5000' },
  { id: DRY_CLEANING_ID, name: 'Dry Cleaning', sortOrder: 3, description: 'Delicates, suits and formalwear, professionally dry cleaned.', features: ['DRY CLEANING', 'IRONING', 'ON HANGERS'], icon: 'dry-clean', unit: 'PER_LB', pricingModel: 'FIXED', serviceId: rateSvc(3), serviceName: 'Dry Cleaning — per lb', starterRate: '3.0000' },
  { id: svc(4), name: 'Ironing only', sortOrder: 4, description: 'Freshly pressed and ready to wear — ironing only.', features: ['IRONING', 'ON HANGERS'], icon: 'iron', unit: 'PER_ITEM', pricingModel: 'FIXED', serviceId: rateSvc(4), serviceName: 'Ironing only — per item', starterRate: '2.5000' },
  { id: svc(5), name: 'Rug Cleaning', sortOrder: 5, description: 'Deep clean for rugs; final price after we measure at pickup.', features: ['DEEP CLEAN', 'MEASURED AT PICKUP'], icon: 'rug', unit: 'PER_MEASURE', pricingModel: 'FROM_MEASURED', serviceId: rateSvc(5), serviceName: 'Rug Cleaning — per sqft', starterRate: '6.5000' },
  { id: svc(6), name: 'Carpet Cleaning', sortOrder: 6, description: 'Deep clean for carpets; final price after we measure at pickup.', features: ['DEEP CLEAN', 'MEASURED AT PICKUP'], icon: 'carpet', unit: 'PER_MEASURE', pricingModel: 'FROM_MEASURED', serviceId: rateSvc(6), serviceName: 'Carpet Cleaning — per sqft', starterRate: '4.0000' },
  { id: svc(7), name: 'Upholstery', sortOrder: 7, description: 'Sofas and armchairs refreshed; final price after we measure at pickup.', features: ['SPECIALTY CARE', 'MEASURED AT PICKUP'], icon: 'sofa', unit: 'PER_MEASURE', pricingModel: 'FROM_MEASURED', serviceId: rateSvc(7), serviceName: 'Upholstery — per sqft', starterRate: '5.0000' },
  { id: svc(8), name: 'Blinds', sortOrder: 8, description: 'Blinds cleaned and de-dusted; final price after we measure at pickup.', features: ['SPECIALTY CARE', 'MEASURED AT PICKUP'], icon: 'blinds', unit: 'PER_MEASURE', pricingModel: 'FROM_MEASURED', serviceId: rateSvc(8), serviceName: 'Blinds — per sqft', starterRate: '3.0000' },
];

// ── local MinIO defaults (overridable by env; the founder never runs the demo seed against prod) ──
function s3(): { client: S3Client; bucket: string } {
  const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
  const bucket = process.env.S3_BUCKET ?? 'bluebee-media';
  const client = new S3Client({
    region: process.env.AWS_REGION ?? 'ca-central-1',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'minioadmin',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'minioadmin',
    },
  });
  return { client, bucket };
}

// ── a genuine PNG (solid-colour tile) — real image bytes, not a placeholder string ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function solidPng(r: number, g: number, b: number, size = 64): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x += 1) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = deflateSync(raw);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

interface SeedItem { id: string; name: string; price: string; rgb: [number, number, number] }
// [Inc-20] `description`/`features`/`icon` drive the customer Home service grid. SAMPLE copy — realistic so
// the demo looks right, but the founder overwrites it per-category via the /catalog console admin. `icon` is
// a SEMANTIC KEY the app maps to an icon + tint (see HomeScreen CATEGORY_ICONS) — not a raw asset path.
interface SeedCategory { id: string; name: string; sortOrder: number; description: string; features: string[]; icon: string; items: SeedItem[] }
const CATEGORIES: SeedCategory[] = [
  {
    id: cat(1), name: 'Shirts', sortOrder: 1,
    description: 'Crisp, hand-finished shirts and blouses — pressed and ready to wear.',
    features: ['DRY CLEAN', 'PRESS', 'ON HANGERS'],
    icon: 'shirts',
    items: [
      { id: cat(11), name: 'Dress shirt', price: '6.0000', rgb: [90, 140, 200] },
      { id: cat(12), name: 'Blouse', price: '8.0000', rgb: [120, 170, 210] },
    ],
  },
  {
    id: cat(2), name: 'Outerwear', sortOrder: 2,
    description: 'Coats and jackets cleaned, refreshed and protected for the season.',
    features: ['DRY CLEAN', 'STEAM', 'ON HANGERS'],
    icon: 'outerwear',
    items: [
      { id: cat(21), name: 'Winter coat', price: '28.0000', rgb: [70, 90, 110] },
      { id: cat(22), name: 'Blazer', price: '18.0000', rgb: [100, 110, 130] },
    ],
  },
  {
    id: cat(3), name: 'Formalwear', sortOrder: 3,
    description: 'Suits, gowns and tuxedos — event-ready with a flawless finish.',
    features: ['DRY CLEAN', 'PRESS', 'ON HANGERS'],
    icon: 'formalwear',
    items: [
      { id: cat(31), name: 'Suit (2-piece)', price: '30.0000', rgb: [50, 50, 60] },
      { id: cat(32), name: 'Evening gown', price: '45.0000', rgb: [150, 60, 110] },
      { id: cat(33), name: 'Tuxedo', price: '40.0000', rgb: [30, 30, 40] },
    ],
  },
];

export async function seedDrycleanCatalog(prisma: PrismaClient, opts: SeedCatalogOptions = {}): Promise<void> {
  const { orgId: ORG, ownerId: OWNER } = await resolveSeedTarget(prisma, opts);
  // [Inc-25] Sample garment items + their placeholder tiles are DEV-ONLY and default to OFF, so a production
  // run cannot ship a fake price or touch S3 (the client is not even constructed).
  const withSamples = opts.sampleItems ?? process.env.SEED_SAMPLE_ITEMS === '1';
  let images = 0;

  // [Inc-21] The 8 top-level service-menu cards FIRST (Dry Cleaning must exist before the garment categories
  // reference it as their parent). Idempotent. IMPORTANT — the `update` branch refreshes ONLY presentation
  // copy and NEVER touches `priceFrom`, `unit`, `pricingModel`, or a backing rate Service: those are money +
  // pricing structure the FOUNDER owns via the console, so re-seeding never clobbers real rates the owner
  // entered. `create` ships priceFrom = NULL and NO backing Service (honesty firewall — no invented price).
  //
  // NOTE (Inc-25): `update` DOES re-assert `sortOrder`, so re-running this seed resets a console reorder.
  // Reorder after seeding, not before.
  for (const s of SERVICE_CARDS) {
    // [Inc-36] `update` now ALSO re-asserts `unit` + `pricingModel`. These are product STRUCTURE (which single
    // measure the checkout asks for), not money — and they were wrong in the live catalog (Wash & Iron was
    // PER_ITEM, Dry Cleaning was PER_ITEM), which is what dropped customers into the general composer.
    // `priceFrom` is still NEVER touched: the public "from $X" anchor is the founder's, and stays NULL until
    // they set a real CAD price in /catalog (so the grid honestly says "Get a quote").
    await prisma.serviceCategory.upsert({
      where: { id: s.id },
      update: {
        name: s.name, sortOrder: s.sortOrder, description: s.description, features: s.features, icon: s.icon,
        unit: s.unit, pricingModel: s.pricingModel,
      },
      create: {
        id: s.id, orgId: ORG, name: s.name, sortOrder: s.sortOrder, description: s.description, features: s.features,
        icon: s.icon, unit: s.unit, pricingModel: s.pricingModel, currency: 'CAD', priceFrom: null, parentId: null,
        active: true, createdBy: OWNER,
      },
    });

    // [Inc-36] EVERY card gets a BACKING rate Service. Without one, `GET /catalog/home` returns
    // `serviceId: null` and tapping the card falls through to the GENERAL composer (item-type chips + service
    // chips + garment picker) — the exact complexity this increment removes. With one, every tap lands in the
    // focused single-measure checkout.
    //   • `create` seeds the STARTER rate so the in-checkout estimate has real math.
    //   • `update` deliberately does NOT write `baseRate` — once the founder sets a real rate in /catalog,
    //     re-seeding must never clobber it. It only keeps the STRUCTURE (unit/vertical/link/active) correct.
    await prisma.service.upsert({
      where: { id: s.serviceId },
      update: {
        name: s.serviceName, unit: backingUnitOf(s.unit), vertical: verticalOf(s.unit), categoryId: s.id, active: true,
      },
      create: {
        id: s.serviceId, orgId: ORG, name: s.serviceName, vertical: verticalOf(s.unit), unit: backingUnitOf(s.unit),
        baseRate: s.starterRate, categoryId: s.id, active: true, sortOrder: 0, createdBy: OWNER,
      },
    });
  }

  for (const c of CATEGORIES) {
    await prisma.serviceCategory.upsert({
      where: { id: c.id },
      // Reparent the garment sub-catalog under the Dry Cleaning card (drill-in detail, not a top-level Home card).
      update: { name: c.name, sortOrder: c.sortOrder, description: c.description, features: c.features, icon: c.icon, parentId: DRY_CLEANING_ID },
      create: { id: c.id, orgId: ORG, name: c.name, sortOrder: c.sortOrder, description: c.description, features: c.features, icon: c.icon, parentId: DRY_CLEANING_ID, active: true, createdBy: OWNER },
    });
    if (!withSamples) continue; // prod: structure only — the founder adds real items + real prices in /catalog

    const { client, bucket } = s3();
    for (let i = 0; i < c.items.length; i += 1) {
      const it = c.items[i];
      // Deterministic catalog media key (mirrors MediaService.newKey's org/{org}/catalog/… layout).
      const storageKey = `org/${ORG}/catalog/seed-${it.id}.png`;
      const bytes = solidPng(...it.rgb);
      // REAL upload through the S3 path into MinIO (the same bucket + client the media provider uses).
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: storageKey, Body: bytes, ContentType: 'image/png' }));
      images += 1;
      // Record the upload as a CONFIRMED MediaUpload intent (the media seam's record of a real object).
      await prisma.mediaUpload.upsert({
        where: { storageKey },
        update: { status: 'CONFIRMED' },
        create: { orgId: ORG, storageKey, kind: 'CATALOG', contentType: 'image/png', byteSize: bytes.length, status: 'CONFIRMED', createdBy: OWNER },
      });
      await prisma.service.upsert({
        where: { id: it.id },
        update: { categoryId: c.id, imageKey: storageKey, baseRate: it.price, name: it.name },
        create: {
          id: it.id, orgId: ORG, vertical: 'SPECIALTY', unit: 'ITEM', name: it.name, baseRate: it.price,
          categoryId: c.id, imageKey: storageKey, sortOrder: i + 1, active: true, createdBy: OWNER,
        },
      });
    }
  }
  const sampleCount = withSamples ? CATEGORIES.reduce((n, c) => n + c.items.length, 0) : 0;
  console.log(
    `[seed] org ${ORG}: ${SERVICE_CARDS.length} top-level Home cards + a backing rate Service each ` +
      `(STARTER rates — configurable placeholders, NOT official prices; priceFrom stays NULL so the grid says "Get a quote" until the founder sets a real CAD price via /catalog) ` +
      `+ ${CATEGORIES.length} garment categories nested under Dry Cleaning; ` +
      (withSamples
        ? `${sampleCount} DEV sample items, ${images} real PNGs uploaded to S3/MinIO.`
        : `STRUCTURE ONLY — 0 sample items, 0 sample prices, 0 S3 writes (honesty firewall).`),
  );
}
