import { resolveMediaConfig, validateMediaUrl } from './media';

const cfg = resolveMediaConfig({
  MEDIA_ALLOWED_ORIGINS: 'https://bluebee-media.s3.ca-central-1.amazonaws.com',
  S3_BUCKET: 'bluebee-media',
  AWS_REGION: 'ca-central-1',
} as NodeJS.ProcessEnv);

describe('media URL validation (PRD §8.3/§12.1 — no fabricated/foreign URLs)', () => {
  it('accepts an https object reference on an allow-listed origin', () => {
    const r = validateMediaUrl('https://bluebee-media.s3.ca-central-1.amazonaws.com/intake/rug-1.jpg', cfg);
    expect(r.ok).toBe(true);
  });

  it('rejects non-https', () => {
    expect(validateMediaUrl('http://bluebee-media.s3.ca-central-1.amazonaws.com/x.jpg', cfg)).toMatchObject({ ok: false });
  });

  it('rejects a foreign / non-allow-listed origin', () => {
    expect(validateMediaUrl('https://evil.example.com/x.jpg', cfg)).toMatchObject({ ok: false });
    expect(validateMediaUrl('https://demo.local/intake/x.jpg', cfg)).toMatchObject({ ok: false });
  });

  it('rejects an origin with no object path', () => {
    expect(validateMediaUrl('https://bluebee-media.s3.ca-central-1.amazonaws.com', cfg)).toMatchObject({ ok: false });
    expect(validateMediaUrl('https://bluebee-media.s3.ca-central-1.amazonaws.com/', cfg)).toMatchObject({ ok: false });
  });

  it('rejects garbage', () => {
    expect(validateMediaUrl('not a url', cfg)).toMatchObject({ ok: false });
  });

  it('fails closed when no origins are configured', () => {
    const empty = resolveMediaConfig({} as NodeJS.ProcessEnv);
    expect(validateMediaUrl('https://anything.example/x.jpg', empty)).toMatchObject({ ok: false });
  });

  it('derives the S3 bucket origin from S3_BUCKET + AWS_REGION', () => {
    const c = resolveMediaConfig({ S3_BUCKET: 'b', AWS_REGION: 'us-east-1' } as NodeJS.ProcessEnv);
    expect(c.allowedOrigins).toContain('https://b.s3.us-east-1.amazonaws.com');
  });
});
