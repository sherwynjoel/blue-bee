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
import { PrismaClient } from '@prisma/client';

const ORG = '11111111-1111-4111-8111-111111111111'; // ID.org (matches seed.ts)
const OWNER = '22222222-2222-4222-8222-222222222222'; // ID.owner
const uuidIn = (prefix: string) => (n: number): string => `${prefix}-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const cat = uuidIn('ca000000');

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
  for (const c of CATEGORIES) {
    await prisma.serviceCategory.upsert({
      where: { id: c.id },
      update: { name: c.name, sortOrder: c.sortOrder, description: c.description, features: c.features, icon: c.icon },
      create: { id: c.id, orgId: ORG, name: c.name, sortOrder: c.sortOrder, description: c.description, features: c.features, icon: c.icon, active: true, createdBy: OWNER },
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
  console.log(`[seed] Inc-17 dry-clean catalog: ${CATEGORIES.length} categories + ${CATEGORIES.reduce((n, c) => n + c.items.length, 0)} sample items; ${images} real PNGs uploaded to MinIO bucket '${bucket}' (SAMPLE prices/images — founder overwrites via /catalog admin).`);
}
