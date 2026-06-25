import { loadMediaConfig } from './media.config';

/** Build a clean env (loadMediaConfig reads only what's passed). */
function env(over: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...over } as NodeJS.ProcessEnv;
}

describe('loadMediaConfig (Increment 10)', () => {
  it('defaults: real AWS S3 (no endpoint), path-style off, 15MB, image+pdf types', () => {
    const c = loadMediaConfig(env({ AWS_REGION: 'ca-central-1', S3_BUCKET: 'bluebee-media' }));
    expect(c.region).toBe('ca-central-1');
    expect(c.bucket).toBe('bluebee-media');
    expect(c.endpoint).toBeNull();
    expect(c.forcePathStyle).toBe(false);
    expect(c.ensureBucket).toBe(false); // never auto-create on real S3
    expect(c.maxBytes).toBe(15 * 1024 * 1024);
    expect(c.presignPutTtlSec).toBe(300);
    expect(c.allowedContentTypes).toEqual(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  });

  it('MinIO endpoint ⇒ path-style + ensureBucket default ON', () => {
    const c = loadMediaConfig(env({ S3_ENDPOINT: 'http://localhost:9000', AWS_ACCESS_KEY_ID: 'minioadmin', AWS_SECRET_ACCESS_KEY: 'minioadmin' }));
    expect(c.endpoint).toBe('http://localhost:9000');
    expect(c.forcePathStyle).toBe(true);
    expect(c.ensureBucket).toBe(true);
    expect(c.accessKeyId).toBe('minioadmin');
  });

  it('explicit overrides win (path-style, ensureBucket, ttls, max, content types)', () => {
    const c = loadMediaConfig(
      env({
        S3_ENDPOINT: 'http://minio:9000',
        S3_FORCE_PATH_STYLE: 'false',
        MEDIA_ENSURE_BUCKET: 'false',
        MEDIA_PRESIGN_PUT_TTL_SEC: '60',
        MEDIA_PRESIGN_GET_TTL_SEC: '120',
        MEDIA_MAX_BYTES: '1048576',
        MEDIA_ALLOWED_CONTENT_TYPES: 'image/jpeg, image/heic',
      }),
    );
    expect(c.forcePathStyle).toBe(false);
    expect(c.ensureBucket).toBe(false);
    expect(c.presignPutTtlSec).toBe(60);
    expect(c.presignGetTtlSec).toBe(120);
    expect(c.maxBytes).toBe(1048576);
    expect(c.allowedContentTypes).toEqual(['image/jpeg', 'image/heic']);
  });

  it('parses the legacy external-reference allow-list (documented fallback)', () => {
    const c = loadMediaConfig(env({ MEDIA_ALLOWED_ORIGINS: 'https://a.example, https://b.example' }));
    expect(c.legacyAllowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });
});
