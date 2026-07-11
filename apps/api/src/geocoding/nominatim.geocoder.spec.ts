import type { GeocodingConfig } from '../config/geocoding.config';
import { GeocodeError, type GeocodeFailureReason } from './geocoder.provider';
import { NominatimGeocoder } from './nominatim.geocoder';

/**
 * Unit tests for NominatimGeocoder (Increment 26). NO network, NO DB: the global `fetch` is stubbed and
 * restored around every test, and the geocoder is constructed directly with a hand-built GeocodingConfig
 * (`minIntervalMs: 0` for most cases so the throttle is inert and the tests are fast). Every documented
 * branch of geocode()/search()/throttle() is covered. We assert on `GeocodeError.reason` and on
 * `instanceof GeocodeError` — never on message text.
 */

/** A GeocodingConfig with sane test defaults; override only what a case needs. */
function makeConfig(
  over: Partial<{ baseUrl: string; userAgent: string; countryCodes: string; minIntervalMs: number; timeoutMs: number }> = {},
): GeocodingConfig {
  return {
    provider: 'nominatim',
    nominatim: {
      baseUrl: over.baseUrl ?? 'https://geocoder.test',
      userAgent: over.userAgent ?? 'blue-bee-test/1.0 (+https://bluebee.test; ops@bluebee.test)',
      countryCodes: over.countryCodes ?? 'ca',
      minIntervalMs: over.minIntervalMs ?? 0,
    },
    google: { apiKey: null },
    timeoutMs: over.timeoutMs ?? 5000,
  };
}

/** A Response-shaped stub whose `json()` resolves `body`. */
function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
/** A non-2xx Response stub. */
function errResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}
/** A 200 Response stub whose `json()` rejects (malformed body). */
function malformedResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('unexpected end of JSON input');
    },
  } as unknown as Response;
}

/** A well-formed Nominatim `/search` hit. lat/lon are STRINGS, as the real API returns them. */
const TORONTO = { lat: '43.6532', lon: '-79.3832', display_name: 'Toronto, ON, Canada' };

/**
 * Await a promise expected to reject with a GeocodeError, assert it IS one, and return its reason.
 * Asserting on the reason (not the message) is the contract callers depend on (422 vs 503).
 */
async function reasonOf(p: Promise<unknown>): Promise<GeocodeFailureReason> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(GeocodeError);
    return (err as GeocodeError).reason;
  }
  throw new Error('expected geocode() to reject, but it resolved');
}

describe('NominatimGeocoder (Increment 26)', () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('1. happy path: parses STRING lat/lon into numbers and returns display_name', async () => {
    fetchMock.mockResolvedValue(okResponse([TORONTO]));
    const geo = new NominatimGeocoder(makeConfig());

    const result = await geo.geocode('Toronto');

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832, formattedAddress: 'Toronto, ON, Canada' });
    expect(typeof result.lat).toBe('number');
    expect(typeof result.lng).toBe('number');
  });

  it('2a. missing display_name ⇒ formattedAddress falls back to the TRIMMED input', async () => {
    fetchMock.mockResolvedValue(okResponse([{ lat: '43.6', lon: '-79.4' }]));
    const geo = new NominatimGeocoder(makeConfig());

    const result = await geo.geocode('  55 King St  ');

    expect(result.formattedAddress).toBe('55 King St');
    expect(result).toMatchObject({ lat: 43.6, lng: -79.4 });
  });

  it('2b. empty display_name ⇒ formattedAddress falls back to the TRIMMED input', async () => {
    fetchMock.mockResolvedValue(okResponse([{ lat: '43.6', lon: '-79.4', display_name: '' }]));
    const geo = new NominatimGeocoder(makeConfig());

    const result = await geo.geocode('  55 King St  ');

    expect(result.formattedAddress).toBe('55 King St');
  });

  it('3. empty / whitespace address ⇒ not_found, and fetch is NEVER called', async () => {
    const geo = new NominatimGeocoder(makeConfig());

    for (const bad of ['', '   ']) {
      expect(await reasonOf(geo.geocode(bad))).toBe('not_found');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('4. empty result array ⇒ not_found', async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    const geo = new NominatimGeocoder(makeConfig());

    expect(await reasonOf(geo.geocode('nowhere at all'))).toBe('not_found');
  });

  it('5. non-array body ⇒ not_found', async () => {
    fetchMock.mockResolvedValue(okResponse({}));
    const geo = new NominatimGeocoder(makeConfig());

    expect(await reasonOf(geo.geocode('Toronto'))).toBe('not_found');
  });

  it('6. upstream non-2xx (500) ⇒ unavailable', async () => {
    fetchMock.mockResolvedValue(errResponse(500));
    const geo = new NominatimGeocoder(makeConfig());

    expect(await reasonOf(geo.geocode('Toronto'))).toBe('unavailable');
  });

  it('7. fetch rejects (network / timeout) ⇒ unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const geo = new NominatimGeocoder(makeConfig());

    expect(await reasonOf(geo.geocode('Toronto'))).toBe('unavailable');
  });

  it('8. res.json() rejects (malformed body) ⇒ unavailable', async () => {
    fetchMock.mockResolvedValue(malformedResponse());
    const geo = new NominatimGeocoder(makeConfig());

    expect(await reasonOf(geo.geocode('Toronto'))).toBe('unavailable');
  });

  it('9. unparseable coordinate (NaN) ⇒ unavailable', async () => {
    fetchMock.mockResolvedValue(okResponse([{ lat: 'abc', lon: '-79.3832', display_name: 'x' }]));
    const geo = new NominatimGeocoder(makeConfig());

    expect(await reasonOf(geo.geocode('Toronto'))).toBe('unavailable');
  });

  it('10a. out-of-range latitude (99.9) ⇒ unavailable', async () => {
    fetchMock.mockResolvedValue(okResponse([{ lat: '99.9', lon: '-79.3832', display_name: 'x' }]));
    const geo = new NominatimGeocoder(makeConfig());

    expect(await reasonOf(geo.geocode('Toronto'))).toBe('unavailable');
  });

  it('10b. out-of-range longitude (999) ⇒ unavailable', async () => {
    fetchMock.mockResolvedValue(okResponse([{ lat: '43.6532', lon: '999', display_name: 'x' }]));
    const geo = new NominatimGeocoder(makeConfig());

    expect(await reasonOf(geo.geocode('Toronto'))).toBe('unavailable');
  });

  it('11. request shape: q, format=jsonv2, limit=1, countrycodes, and the user-agent header', async () => {
    fetchMock.mockResolvedValue(okResponse([TORONTO]));
    const config = makeConfig({ baseUrl: 'https://geo.example.org', countryCodes: 'ca', userAgent: 'ua-under-test/9.9 (+contact)' });
    const geo = new NominatimGeocoder(config);

    await geo.geocode('123 Main St, Toronto');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url).toBeInstanceOf(URL);
    expect(url.origin).toBe('https://geo.example.org');
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('123 Main St, Toronto');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('countrycodes')).toBe('ca');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['user-agent']).toBe('ua-under-test/9.9 (+contact)');
  });

  it('12. rate limiting: concurrent calls are spaced >= minIntervalMs apart', async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(() => {
      times.push(Date.now());
      return Promise.resolve(okResponse([TORONTO]));
    });
    const geo = new NominatimGeocoder(makeConfig({ minIntervalMs: 50 }));

    await Promise.all([geo.geocode('a'), geo.geocode('b'), geo.geocode('c')]);

    expect(times).toHaveLength(3);
    // Consecutive outbound calls must be spaced by ~minIntervalMs (allow a little scheduler slack).
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(45);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(45);
  }, 10000);

  it('13. a rejected call does not poison the throttle chain', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(okResponse([TORONTO]));
    const geo = new NominatimGeocoder(makeConfig());

    // Register both synchronously so ordering on the single-flight queue is deterministic.
    const first = geo.geocode('one');
    const second = geo.geocode('two');

    expect(await reasonOf(first)).toBe('unavailable');
    await expect(second).resolves.toEqual({ lat: 43.6532, lng: -79.3832, formattedAddress: 'Toronto, ON, Canada' });
  });
});
