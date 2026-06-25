/**
 * Re-export of the shared token-store seam from `@blue-bee/api-client` (extracted in Increment 11).
 * The native keychain impl (`SecureTokenStore`) stays app-local in `./secure-token-store`. Kept as a
 * thin barrel so existing driver imports (`./token-store`) are unchanged.
 */
export { MemoryTokenStore } from '@blue-bee/api-client';
export type { TokenStore } from '@blue-bee/api-client';
