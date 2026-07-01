# S3 media go-live — real bucket `bluebee-media-prod`, proven end-to-end (NO STUB)

**Branch:** `feature/s3-media-golive` off `main` (`7d8297f`, the landed Inc-19 tip).
**Feature commit:** `9cbe463` (+ this bookkeeping commit).
**Single CC session.** Pushed to `origin/feature/s3-media-golive`. **NOT merged — founder lands it (ff), sets the Railway vars, redeploys.** `7d1fa47` untouched; no force-push. **No migration** (config + verification only).

---

## Gates (both passed before any code)

- **Gate 1 — main tip:** `7d8297f` (Inc-19 landed). Branched off it.
- **Gate 2 — real creds + bucket:** live AWS creds available via `~/.aws` (IAM user `pyng-deploy`, account `877869618538`). Founder authorized creating a dedicated bucket in that account. **Created `bluebee-media-prod` (ca-central-1)** and verified real `PutObject`/`GetObject`/`HeadObject`/`DeleteObject` before writing the proof. No key is in `.env` — the SDK default chain reads `~/.aws`, so nothing secret is committed or echoed.

---

## Step 0 findings (the media seam as-built)

The pipeline is **already env-selectable and correct for real S3 — no code change was needed:**
- `apps/api/src/media/storage/s3-storage.provider.ts`: `new S3Client({ region, ...(endpoint ? {endpoint, forcePathStyle} : {}), ...(creds ? {credentials} : {}) })`. **`S3_ENDPOINT` set ⇒ MinIO (path-style); unset ⇒ real AWS S3 (virtual-hosted).** Creds omitted ⇒ SDK default chain (`~/.aws`). `onModuleInit` only `ensureBucket`s for a custom endpoint (never prod).
- `apps/api/src/config/media.config.ts`: `region` defaults to `ca-central-1`, `forcePathStyle`/`ensureBucket` auto-off when no endpoint, optional `MEDIA_SSE`. The bucket carries **default encryption** (an IaC concern) so the presign stays a clean single-header PUT.
- `MediaService`: `presign`/`confirm` (generic), `presignForStop`/`confirmForStop` (POD), `presignCatalogImage`/`confirmCatalogImage` (catalog). All: allow-list + size cap + **org-namespaced unguessable key** `org/{orgId}/{kind}/{uuid}.{ext}` + PENDING→CONFIRMED intent + **HEAD-verify** (content-type + size; a bad object is deleted). `MediaSigner.signedGet` = presigned GET (private, short-lived).
- **Consumers (all proven):** (1) generic order/item photos, (2) driver POD photo+signature, (3) Inc-17 catalog item images. Reads everywhere go through signed GETs (never a raw key/public link).

---

## AWS-side setup (done)

- **Bucket** `bluebee-media-prod`, region **`ca-central-1`** (Canadian PII data residency — PRD §12.2).
- **Default encryption:** SSE-S3/**AES256** (BucketKeyEnabled).
- **Public access:** all four blocks **true** (private bucket).
- **CORS** applied (PUT/GET/HEAD from `https://*.up.railway.app` + localhost dev origins). See §9 of `docs/DEPLOY-RAILWAY.md` for the exact JSON.
- **Least-privilege IAM** documented (Put/Get/Head/Delete on `arn:aws:s3:::bluebee-media-prod/*`) — §9.

---

## LIVE S3 evidence (`npm run s3-proof` → 18/18 against the REAL bucket)

Boots the real app with a real-S3 `MEDIA_CONFIG` override (endpoint null, bucket `bluebee-media-prod`, creds via `~/.aws`), local Postgres+Redis behind the DB, and drives the REAL endpoints. Every presigned URL host was `bluebee-media-prod.s3.ca-central-1.amazonaws.com` (not `localhost:9000`).

```
✓ provider targets REAL AWS S3 (no MinIO endpoint) — bucket=bluebee-media-prod region=ca-central-1 endpoint=aws-s3
✓ generic: presigned PUT is a real signed AWS URL — bluebee-media-prod.s3.ca-central-1.amazonaws.com
✓ generic: PUT real bytes to REAL S3
✓ generic: confirm HEAD-verified + Photo created
✓ generic: object present in REAL bucket (HEAD) — size=518
✓ generic: signed GET returns BYTE-IDENTICAL bytes from REAL S3 — dl=200 len=518
✓ privacy: UNSIGNED object URL is 403 (bucket private) — HTTP 403
✓ catalog: PUT real PNG to REAL S3
✓ catalog: item created with confirmed image; signed imageUrl
✓ catalog: signed imageUrl serves BYTE-IDENTICAL PNG from REAL S3 — dl=200 len=69
✓ POD: presign is a POD-kind org-namespaced key — org/…/pod/…​.jpg
✓ POD: PUT real bytes to REAL S3
✓ POD: confirmForStop HEAD-verified + POD Photo created
✓ POD: signed GET returns BYTE-IDENTICAL POD bytes from REAL S3 — dl=200
✓ security: an unconfirmed/unuploaded key is REJECTED (not persisted) — HTTP 404
✓ tenancy: another org cannot confirm this org's key (404) — HTTP 404
✓ privacy: a short-TTL signed GET EXPIRES (2s TTL → 403 after 4s) — HTTP 403
[real bucket bluebee-media-prod] objects under org/ before cleanup: 4
✓ cleanup: deleted all test objects from the bucket — 4/4 keys deleted
=== S3 GO-LIVE PROOF: 18/18 checks passed (REAL bucket bluebee-media-prod @ ca-central-1) ===
```
Bucket verified **empty** after cleanup (`aws s3 ls s3://bluebee-media-prod/ --recursive` → 0). POD note: the media byte round-trip is proven at the service level (`presignForStop`/`confirmForStop` → POD Photo → signed GET → byte-identical); the route/ProofOfDelivery record-linking is storage-agnostic and already MinIO-e2e-proven (`pod.e2e-spec.ts`), so it isn't re-run against S3.

---

## No-stub + key-hygiene sweeps (pasted)

```
# no-stub (shipped non-test paths):
grep -rniE 'TODO|FIXME|stub|mock|fake' apps/api/scripts/s3-golive-proof.ts apps/api/package.json | grep -v '.test.'
→ only hit: the proof script's own docstring "NO STUB, NO MinIO" (prose asserting the opposite — benign)

# key-hygiene (whole diff vs main):
git diff main -- . ':(exclude)Projects' | grep -inE 'AKIA[0-9A-Z]{16}|aws_secret…|BEGIN|minioadmin' | grep -v '#|placeholder|<real|<key'
→ ✓ CLEAN — no AWS key / secret committed anywhere in the diff
```
`apps/api/.env` (which now carries the local MinIO block) is **gitignored** and NOT staged. The real AWS key lives only in `~/.aws` / (for prod) Railway variables — never in the repo.

---

## 6-lens adversarial QC (refute-by-default — all HOLD)

1. **real-S3-not-MinIO** — REFUTED "it's secretly MinIO": every presigned URL host is `bluebee-media-prod.s3.ca-central-1.amazonaws.com`; `provider.head` against real S3 returns the object (size=518); `aws s3 ls s3://bluebee-media-prod/org/` listed 4 real objects. The override config has `endpoint:null`. HOLDS.
2. **byte integrity** — REFUTED "bytes differ": `got.equals(bytes)` true for generic (518=518), catalog PNG (69=69), and POD, each fetched through the signed GET. HOLDS.
3. **privacy** — REFUTED "publicly readable / never expires": the raw unsigned object URL 403s (all public-access blocks on); a short-TTL signed GET 403s once its window passes. HOLDS.
4. **tenancy** — REFUTED "cross-org read": keys are `org/{orgId}/…`; another org confirming this org's key → 404 (`requireIntent` org check). HOLDS.
5. **key hygiene** — REFUTED "secret leaks": key-hygiene sweep clean; the proof uses the `~/.aws` default chain (no key in code/env); the server credential never reaches the client (the client only ever sees a presigned URL bearing a signature, not the key). HOLDS.
6. **local dev intact** — REFUTED "S3 broke MinIO": full MinIO e2e **298/298** (28 suites) green with `.env` on the MinIO block; the switch is pure env (`S3_ENDPOINT` set ⇒ MinIO), not a code break. HOLDS.

---

## Definition of Done — evidence

- ✅ Step-0 findings above (consumers; the config is already env-selectable — no code change).
- ✅ Real S3 selected by env; MinIO still works locally (MinIO e2e 298/298; `.env` MinIO block).
- ✅ **Live S3 evidence** (above): generic + POD + catalog byte-identical against the REAL bucket; objects confirmed present then cleaned up.
- ✅ Security: unconfirmed key 404; unsigned URL 403 (private); signed-GET expiry; cross-org 404.
- ✅ **No migration.**
- ✅ Suites green: API e2e **298/298**, web **137/137**, customer **98/98**; api typecheck clean. **No new jest tests** (the go-live proof is a runnable script `npm run s3-proof` — deliberately not a CI test since it needs live creds + hits the real bucket; the MinIO e2e remains CI coverage). Before=after: **298 / 137 / 98**.
- ✅ No-stub + key-hygiene sweeps clean (pasted).
- ✅ `docs/DEPLOY-RAILWAY.md` §9 (Railway vars, CORS JSON, IAM policy) + `.env.example` prod placeholders.
- ✅ Test objects cleaned up (bucket empty).

---

## Founder cutover (activate prod)

Set on Railway `api` (see §9): `AWS_REGION=ca-central-1`, `S3_BUCKET=bluebee-media-prod`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (leave `S3_ENDPOINT` UNSET). Then redeploy → driver POD photos + Inc-17 catalog images become real in the pilot. Consider a **dedicated Blue Bee IAM user** (least-privilege policy in §9) rather than reusing `pyng-deploy`, and tightening CORS `AllowedOrigins` to the exact web origin.

**Next: Google Maps (Inc staged, waiting on the keys).**
