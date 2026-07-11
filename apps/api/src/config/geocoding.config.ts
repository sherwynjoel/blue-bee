/**
 * Typed geocoding configuration (Increment 26) — the address → WGS84 point rail. Mirrors the other
 * typed config factories (AUTH_CONFIG / PAYMENTS_CONFIG / MEDIA_CONFIG): every tunable comes from the
 * environment, provided via `{ provide: GEOCODING_CONFIG, useFactory: loadGeocodingConfig }`.
 *
 * PROVIDER CHOICE. `GOOGLE_MAPS_API_KEY` is declared in `.env.example` but has never been provisioned,
 * and no Google SDK is a dependency of this repo — meanwhile `apps/web` already renders Leaflet +
 * OpenStreetMap. So the shipped default is **Nominatim** (OSM's geocoder): keyless, same data source as
 * the map the customer already sees, and adequate for address-entry volume.
 *
 * There is deliberately NO local/offline geocoder. A payment provider can fall back to a deterministic
 * local implementation because a fake payment intent is inert; a fake COORDINATE is not — it would put a
 * truck at the wrong door and silently poison the serviceability gate. When the provider cannot resolve
 * an address the API fails loudly (422 / 503) and writes no row. (Honesty firewall, CLAUDE.md.)
 *
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/) requires an
 * identifying User-Agent and caps traffic at ~1 request/second; `NOMINATIM_USER_AGENT` and the
 * single-flight rate limiter in NominatimGeocoder honour both.
 */
export const GEOCODING_CONFIG = Symbol('GEOCODING_CONFIG');

/** Which upstream resolves an address. `google` is reserved for when a billable key is provisioned. */
export type GeocoderKind = 'nominatim' | 'google';

export interface GeocodingConfig {
  provider: GeocoderKind;
  nominatim: {
    /** Base URL of the Nominatim instance (override to self-host and lift the rate cap). */
    baseUrl: string;
    /** REQUIRED by OSM policy — an identifying UA with a contact address. */
    userAgent: string;
    /** Bias + restrict results to these ISO-3166-1 alpha-2 country codes. */
    countryCodes: string;
    /** Minimum millisecond gap between outbound calls (OSM policy: ≥ 1000 ms). */
    minIntervalMs: number;
  };
  google: {
    /** Server-side Geocoding API key. Null ⇒ the `google` provider cannot be selected. */
    apiKey: string | null;
  };
  /** Per-request timeout for the outbound geocode call. */
  timeoutMs: number;
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function optional(name: string): string | null {
  const v = process.env[name];
  return v === undefined || v === '' ? null : v;
}

export function loadGeocodingConfig(): GeocodingConfig {
  const googleKey = optional('GOOGLE_MAPS_API_KEY');
  const requested = str('GEOCODER_PROVIDER', 'nominatim') as GeocoderKind;

  // Never silently downgrade: asking for `google` without a key is a boot-time misconfiguration, not a
  // reason to quietly resolve addresses against a different upstream than the operator intended.
  if (requested === 'google' && !googleKey) {
    throw new Error('GEOCODER_PROVIDER=google requires GOOGLE_MAPS_API_KEY to be set');
  }
  if (requested !== 'google' && requested !== 'nominatim') {
    throw new Error(`GEOCODER_PROVIDER must be 'nominatim' or 'google' (got '${requested}')`);
  }

  return {
    provider: requested,
    nominatim: {
      baseUrl: str('NOMINATIM_BASE_URL', 'https://nominatim.openstreetmap.org'),
      userAgent: str('NOMINATIM_USER_AGENT', 'blue-bee/1.0 (+https://bluebee.ca; ops@bluebee.ca)'),
      countryCodes: str('NOMINATIM_COUNTRY_CODES', 'ca'),
      minIntervalMs: int('NOMINATIM_MIN_INTERVAL_MS', 1100),
    },
    google: { apiKey: googleKey },
    timeoutMs: int('GEOCODER_TIMEOUT_MS', 5000),
  };
}
