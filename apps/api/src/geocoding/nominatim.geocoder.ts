import { Inject, Injectable, Logger } from '@nestjs/common';
import { GEOCODING_CONFIG, type GeocodingConfig } from '../config/geocoding.config';
import { GeocodeError, type GeocodeResult, type GeocoderProvider } from './geocoder.provider';

/** The subset of a Nominatim `/search` result we rely on. Everything else is ignored. */
interface NominatimSearchResult {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
}

/**
 * The shipped geocoder: OpenStreetMap's Nominatim (Increment 26). Keyless, and the same data source as
 * the Leaflet/OSM basemap `apps/web` already renders, so a pin and its address agree.
 *
 * Two obligations from OSM's usage policy are enforced here rather than documented and forgotten:
 *   1. **An identifying User-Agent** on every request (config: `NOMINATIM_USER_AGENT`).
 *   2. **At most ~1 request/second.** `throttle()` serializes every outbound call through a single
 *      promise chain and spaces them by `minIntervalMs`. Concurrent callers queue rather than burst —
 *      exceeding the cap gets the whole platform's IP blocked, which would take saved addresses down.
 *
 * Any non-answer throws `GeocodeError`. A missing/ambiguous address is `not_found` (permanent, 422); a
 * timeout, non-2xx, or unparseable body is `unavailable` (transient, 503). No coordinate is ever
 * invented, defaulted, or approximated — see geocoder.provider.ts.
 */
@Injectable()
export class NominatimGeocoder implements GeocoderProvider {
  private readonly logger = new Logger(NominatimGeocoder.name);
  /** Tail of the serialized request chain — the rate limiter's only state. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(@Inject(GEOCODING_CONFIG) private readonly config: GeocodingConfig) {}

  async geocode(address: string): Promise<GeocodeResult> {
    const trimmed = address.trim();
    if (trimmed.length === 0) {
      throw new GeocodeError('not_found', 'cannot geocode an empty address');
    }
    const body = await this.throttle(() => this.search(trimmed));

    if (!Array.isArray(body) || body.length === 0) {
      throw new GeocodeError('not_found', `no match for address: ${trimmed}`);
    }
    const top = body[0] as NominatimSearchResult;
    // Nominatim returns lat/lon as STRINGS. A silent NaN here would become a NaN point in PostGIS.
    const lat = Number.parseFloat(String(top.lat));
    const lng = Number.parseFloat(String(top.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new GeocodeError('unavailable', `geocoder returned an unparseable point for: ${trimmed}`);
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new GeocodeError('unavailable', `geocoder returned an out-of-range point for: ${trimmed}`);
    }

    const formattedAddress = typeof top.display_name === 'string' && top.display_name.length > 0 ? top.display_name : trimmed;
    return { lat, lng, formattedAddress };
  }

  /** One outbound `/search` call. Throws `GeocodeError('unavailable')` on any transport-level failure. */
  private async search(address: string): Promise<unknown> {
    const { baseUrl, userAgent, countryCodes } = this.config.nominatim;
    const url = new URL('/search', baseUrl);
    url.searchParams.set('q', address);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    if (countryCodes) url.searchParams.set('countrycodes', countryCodes);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      // Transport error or timeout — we learned nothing about whether the address is real.
      this.logger.warn(`geocode transport failure: ${(err as Error).message}`);
      throw new GeocodeError('unavailable', 'the geocoding provider is unreachable', err);
    }

    if (!res.ok) {
      this.logger.warn(`geocode upstream ${res.status} for "${address}"`);
      throw new GeocodeError('unavailable', `the geocoding provider returned ${res.status}`);
    }
    try {
      return await res.json();
    } catch (err) {
      throw new GeocodeError('unavailable', 'the geocoding provider returned a malformed body', err);
    }
  }

  /**
   * Serialize every outbound call and space consecutive ones by `minIntervalMs` (OSM policy). Tasks
   * chain off `this.queue`, so N concurrent `geocode()` calls issue N spaced requests rather than a
   * burst. A rejected task must not poison the chain, hence the swallow on the tail.
   */
  private throttle<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const waitMs = this.lastRequestAt + this.config.nominatim.minIntervalMs - Date.now();
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.lastRequestAt = Date.now();
      return task();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
