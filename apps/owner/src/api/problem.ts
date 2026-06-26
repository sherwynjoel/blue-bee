/**
 * Re-export of the shared problem+json / ApiError from `@blue-bee/api-client`. Thin barrel so app
 * imports (`./problem`) read cleanly.
 */
export { ApiError } from '@blue-bee/api-client';
export type { ProblemDetails } from '@blue-bee/api-client';
