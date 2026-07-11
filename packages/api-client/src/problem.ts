/**
 * RFC 7807 problem+json shape the Blue Bee API returns on errors, plus a typed Error wrapper so
 * screens can branch on `status` / `code` — e.g. a 409 is treated as the SERVER's authority (the
 * app re-syncs to server truth rather than assuming its optimistic guess was right): the driver's
 * §5.4 illegal-stop-transition and the customer's quote double-approve / expired-quote race both
 * surface here as `ApiError.isConflict`.
 *
 * Shared by both Expo apps (and their headless integration proofs) via `@blue-bee/api-client`.
 */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  /** Some endpoints use `error` as the stable machine code; others `title`. */
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: ProblemDetails,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Stable machine code (problem `error` or `title`), if any. */
  get code(): string | undefined {
    return this.problem.error ?? this.problem.title;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** A 409 — the server rejecting our action because its state moved. Treat as authority + re-sync. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /**
   * [Inc-19] A 422 `zone.out_of_service_area` — the server (authoritative) blocked a booking because its
   * service point falls outside every active service zone. The app surfaces a calm out-of-area state (the
   * server already captured the address as demand). Matches ZONE_ERRORS.OUT_OF_SERVICE_AREA in @blue-bee/shared.
   */
  get isOutOfServiceArea(): boolean {
    return this.status === 422 && this.code === 'zone.out_of_service_area';
  }

  /**
   * [Inc-26] A 422 `site.geocode_failed` — the server could not resolve the typed address to a point, so it
   * saved nothing (it will never invent a coordinate). This is the USER's to fix: correct the address, or drop
   * a pin. Distinct from `isOutOfServiceArea`, which means the address resolved fine but lies outside coverage.
   * Matches SITE_ERRORS.GEOCODE_FAILED in @blue-bee/shared.
   */
  get isGeocodeFailed(): boolean {
    return this.status === 422 && this.code === 'site.geocode_failed';
  }

  /**
   * [Inc-26] A 503 `site.geocode_unavailable` — the geocoding provider is down or timed out. We learned
   * nothing about the address, so this is TRANSIENT: the app should offer a retry rather than tell the
   * customer their address is wrong. Matches SITE_ERRORS.GEOCODE_UNAVAILABLE in @blue-bee/shared.
   */
  get isGeocodeUnavailable(): boolean {
    return this.status === 503 && this.code === 'site.geocode_unavailable';
  }

  static async from(res: Response): Promise<ApiError> {
    let problem: ProblemDetails = {};
    try {
      problem = (await res.json()) as ProblemDetails;
    } catch {
      // non-JSON body — keep an empty problem
    }
    const message = problem.detail ?? problem.message ?? problem.title ?? problem.error ?? `HTTP ${res.status}`;
    return new ApiError(res.status, problem, message);
  }
}
