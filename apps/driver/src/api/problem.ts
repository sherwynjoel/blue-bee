/**
 * Re-export of the shared problem+json / ApiError from `@blue-bee/api-client` (extracted in
 * Increment 11). Kept as a thin barrel so existing driver imports (`./problem`) are unchanged.
 */
export { ApiError } from '@blue-bee/api-client';
export type { ProblemDetails } from '@blue-bee/api-client';
