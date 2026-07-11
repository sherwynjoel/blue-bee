/**
 * The Geocoder seam (Increment 26) — the ONLY outbound address→coordinate touch-point (mirrors
 * PaymentProvider / StorageProvider / EtaEstimator). One real implementation ships behind the
 * `GEOCODER_PROVIDER` token: `NominatimGeocoder` (OpenStreetMap, keyless), env-selectable to a Google
 * implementation once a billable server key exists.
 *
 * NOTE the deliberate asymmetry with `PaymentProvider`, which falls back to a deterministic
 * `LocalPaymentProvider` when no key is configured. There is **no local geocoder**. A synthetic payment
 * intent is inert; a synthetic COORDINATE is load-bearing — it routes a truck and feeds the
 * serviceability gate. So this seam has exactly two honest outcomes: a real resolved point, or a
 * thrown error. Never a plausible guess. (Honesty firewall, CLAUDE.md.)
 */
export const GEOCODER_PROVIDER = Symbol('GEOCODER_PROVIDER');

/** A resolved address — the point plus the upstream's canonical formatting of what it matched. */
export interface GeocodeResult {
  /** WGS84 longitude. Argument order matches ST_MakePoint(lng, lat). */
  lng: number;
  /** WGS84 latitude. */
  lat: number;
  /** The provider's normalized one-line address for the point it actually matched. */
  formattedAddress: string;
}

/**
 * Why a geocode did not produce a point. The distinction is the whole reason this class exists:
 *   • `not_found`   — the upstream answered, and the answer is "no such address". PERMANENT: retrying
 *                     the same string cannot help, so the API returns 422 and saves nothing.
 *   • `unavailable` — the upstream errored, timed out, rate-limited, or returned malformed JSON. We do
 *                     not know whether the address is valid. TRANSIENT: the API returns 503 and the
 *                     caller may retry.
 * Collapsing these two would either tell a customer their real address doesn't exist, or invite an
 * infinite retry against a typo.
 */
export type GeocodeFailureReason = 'not_found' | 'unavailable';

export class GeocodeError extends Error {
  constructor(
    readonly reason: GeocodeFailureReason,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GeocodeError';
  }
}

export interface GeocoderProvider {
  /**
   * Resolve a free-text address to a single WGS84 point.
   * @throws {GeocodeError} `not_found` when the upstream has no match; `unavailable` on any transport,
   *         timeout, rate-limit, or parse failure. NEVER returns an approximate or default coordinate.
   */
  geocode(address: string): Promise<GeocodeResult>;
}
