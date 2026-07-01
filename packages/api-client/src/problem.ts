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
