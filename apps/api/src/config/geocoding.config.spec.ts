import { loadGeocodingConfig } from './geocoding.config';

/**
 * Unit tests for loadGeocodingConfig (Increment 26). loadGeocodingConfig() reads process.env directly,
 * so we save/restore every key it looks at around each case (house style: see notifications.config.spec.ts).
 * setup-env.ts sets no geocoding vars, but we still delete them explicitly so "clean env" is hermetic.
 */

/** Every env var loadGeocodingConfig consults. */
const KEYS = [
  'GEOCODER_PROVIDER',
  'GOOGLE_MAPS_API_KEY',
  'NOMINATIM_BASE_URL',
  'NOMINATIM_USER_AGENT',
  'NOMINATIM_COUNTRY_CODES',
  'NOMINATIM_MIN_INTERVAL_MS',
  'GEOCODER_TIMEOUT_MS',
] as const;

/** Apply `overrides` (undefined ⇒ delete) over a snapshot of KEYS, run fn, then restore. */
function withEnv(overrides: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of KEYS) saved[k] = process.env[k];
  try {
    // Start each case from a clean slate so the ambient environment never leaks in.
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('loadGeocodingConfig (Increment 26)', () => {
  it('1. defaults on a clean env: nominatim, OSM base URL, 1100ms interval, 5000ms timeout', () => {
    withEnv({}, () => {
      const c = loadGeocodingConfig();
      expect(c.provider).toBe('nominatim');
      expect(c.nominatim.baseUrl).toBe('https://nominatim.openstreetmap.org');
      expect(c.nominatim.countryCodes).toBe('ca');
      expect(c.nominatim.minIntervalMs).toBe(1100);
      expect(c.timeoutMs).toBe(5000);
      expect(c.nominatim.userAgent).toContain('blue-bee');
      expect(c.google.apiKey).toBeNull();
    });
  });

  it('2. provider=google without GOOGLE_MAPS_API_KEY throws (no silent downgrade)', () => {
    withEnv({ GEOCODER_PROVIDER: 'google' }, () => {
      expect(() => loadGeocodingConfig()).toThrow(/GOOGLE_MAPS_API_KEY/);
    });
  });

  it('3. provider=google with a key selects google and surfaces the key', () => {
    withEnv({ GEOCODER_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'AIza-test-key' }, () => {
      const c = loadGeocodingConfig();
      expect(c.provider).toBe('google');
      expect(c.google.apiKey).toBe('AIza-test-key');
    });
  });

  it('4. an unknown provider (mapbox) throws', () => {
    withEnv({ GEOCODER_PROVIDER: 'mapbox' }, () => {
      expect(() => loadGeocodingConfig()).toThrow(/nominatim.*google|google.*nominatim/);
    });
  });

  it('5. env overrides are honoured', () => {
    withEnv(
      {
        NOMINATIM_BASE_URL: 'https://nominatim.self-hosted.internal',
        NOMINATIM_USER_AGENT: 'custom-ua/2.0 (+ops@example.com)',
        NOMINATIM_COUNTRY_CODES: 'us,ca',
        NOMINATIM_MIN_INTERVAL_MS: '250',
        GEOCODER_TIMEOUT_MS: '8000',
      },
      () => {
        const c = loadGeocodingConfig();
        expect(c.provider).toBe('nominatim');
        expect(c.nominatim.baseUrl).toBe('https://nominatim.self-hosted.internal');
        expect(c.nominatim.userAgent).toBe('custom-ua/2.0 (+ops@example.com)');
        expect(c.nominatim.countryCodes).toBe('us,ca');
        expect(c.nominatim.minIntervalMs).toBe(250);
        expect(c.timeoutMs).toBe(8000);
      },
    );
  });

  it('6. empty-string env vars are treated as unset (fall back to defaults)', () => {
    withEnv(
      {
        GEOCODER_PROVIDER: '',
        NOMINATIM_BASE_URL: '',
        NOMINATIM_USER_AGENT: '',
        NOMINATIM_COUNTRY_CODES: '',
        NOMINATIM_MIN_INTERVAL_MS: '',
        GEOCODER_TIMEOUT_MS: '',
      },
      () => {
        const c = loadGeocodingConfig();
        expect(c.provider).toBe('nominatim');
        expect(c.nominatim.baseUrl).toBe('https://nominatim.openstreetmap.org');
        expect(c.nominatim.countryCodes).toBe('ca');
        expect(c.nominatim.minIntervalMs).toBe(1100);
        expect(c.timeoutMs).toBe(5000);
      },
    );
  });
});
