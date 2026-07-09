/**
 * Inc-17 — dry-clean visual catalog seed. Seeds ~3 categories + ~7 SAMPLE items (Service, unit ITEM),
 * each with a REAL image pushed into local MinIO through the SAME AWS-SDK S3 path the media provider uses
 * (no hard-coded URLs, no placeholder strings). The image bytes are genuine PNGs generated here (a small
 * solid-colour tile per item), PUT into the `S3_BUCKET`, recorded as a CONFIRMED MediaUpload, and
 * referenced by `Service.imageKey` (signed on read like any other media).
 *
 * SAMPLE DATA: the prices + placeholder-tile images are obviously-sample values — the founder overwrites
 * them for real via the `/catalog` admin screen (upload a real photo + set the real price) after this ships.
 *
 * Idempotent: deterministic ids; a re-run upserts the same rows + re-PUTs the same keys.
 */
import { deflateSync } from 'node:zlib';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient, type PricingModel, type PricingUnit } from '@prisma/client';

const ORG = '11111111-1111-4111-8111-111111111111'; // ID.org (matches seed.ts)
const OWNER = '22222222-2222-4222-8222-222222222222'; // ID.owner
const uuidIn = (prefix: string) => (n: number): string => `${prefix}-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const cat = uuidIn('ca000000');
const svc = uuidIn('5e000000'); // [Inc-21] the 8 top-level service-menu cards

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
}
const SERVICE_CARDS: ServiceCard[] = [
  { id: svc(1), name: 'Wash & Fold', sortOrder: 1, description: 'For everyday laundry, bedsheets and towels.', features: ['WASH', 'TUMBLE-DRY', 'FOLDED', 'IN A BAG'], icon: 'wash-fold', unit: 'PER_KG', pricingModel: 'FIXED' },
  { id: svc(2), name: 'Wash & Iron', sortOrder: 2, description: 'Everyday clothes washed and pressed, back on hangers.', features: ['WASH', 'TUMBLE-DRY', 'IRONING', 'ON HANGERS'], icon: 'wash-iron', unit: 'PER_ITEM', pricingModel: 'FIXED' },
  { id: DRY_CLEANING_ID, name: 'Dry Cleaning', sortOrder: 3, description: 'Delicates, suits and formalwear, professionally dry cleaned.', features: ['DRY CLEANING', 'IRONING', 'ON HANGERS'], icon: 'dry-clean', unit: 'PER_ITEM', pricingModel: 'FIXED' },
  { id: svc(4), name: 'Ironing only', sortOrder: 4, description: 'Freshly pressed and ready to wear — ironing only.', features: ['IRONING', 'ON HANGERS'], icon: 'iron', unit: 'PER_ITEM', pricingModel: 'FIXED' },
  { id: svc(5), name: 'Rug Cleaning', sortOrder: 5, description: 'Deep clean for rugs; final price after we measure at pickup.', features: ['DEEP CLEAN', 'MEASURED AT PICKUP'], icon: 'rug', unit: 'PER_MEASURE', pricingModel: 'FROM_MEASURED' },
  { id: svc(6), name: 'Carpet Cleaning', sortOrder: 6, description: 'Deep clean for carpets; final price after we measure at pickup.', features: ['DEEP CLEAN', 'MEASURED AT PICKUP'], icon: 'carpet', unit: 'PER_MEASURE', pricingModel: 'FROM_MEASURED' },
  { id: svc(7), name: 'Upholstery', sortOrder: 7, description: 'Sofas and armchairs refreshed; final price after we measure at pickup.', features: ['SPECIALTY CARE', 'MEASURED AT PICKUP'], icon: 'sofa', unit: 'PER_MEASURE', pricingModel: 'FROM_MEASURED' },
  { id: svc(8), name: 'Blinds', sortOrder: 8, description: 'Blinds cleaned and de-dusted; final price after we measure at pickup.', features: ['SPECIALTY CARE', 'MEASURED AT PICKUP'], icon: 'blinds', unit: 'PER_MEASURE', pricingModel: 'FROM_MEASURED' },
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

export async function seedDrycleanCatalog(prisma: PrismaClient): Promise<void> {
  const { client, bucket } = s3();
  let images = 0;

  // [Inc-21] The 8 top-level service-menu cards FIRST (Dry Cleaning must exist before the garment categories
  // reference it as their parent). Idempotent. IMPORTANT — the `update` branch refreshes ONLY presentation
  // copy and NEVER touches `priceFrom`, `unit`, `pricingModel`, or a backing rate Service: those are money +
  // pricing structure the FOUNDER owns via the console, so re-seeding never clobbers real rates the owner
  // entered. `create` ships priceFrom = NULL and NO backing Service (honesty firewall — no invented price).
  for (const s of SERVICE_CARDS) {
    await prisma.serviceCategory.upsert({
      where: { id: s.id },
      update: { name: s.name, sortOrder: s.sortOrder, description: s.description, features: s.features, icon: s.icon },
      create: {
        id: s.id, orgId: ORG, name: s.name, sortOrder: s.sortOrder, description: s.description, features: s.features,
        icon: s.icon, unit: s.unit, pricingModel: s.pricingModel, currency: 'CAD', priceFrom: null, parentId: null,
        active: true, createdBy: OWNER,
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
  console.log(
    `[seed] Inc-21 service menu: ${SERVICE_CARDS.length} top-level Home cards (priceFrom NULL, NO rate — founder sets real CAD prices via /catalog) ` +
      `+ Inc-17 dry-clean sub-catalog: ${CATEGORIES.length} garment categories (nested under Dry Cleaning) + ` +
      `${CATEGORIES.reduce((n, c) => n + c.items.length, 0)} sample items; ${images} real PNGs uploaded to MinIO bucket '${bucket}'.`,
  );
}
