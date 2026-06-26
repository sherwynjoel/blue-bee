/**
 * The Blue Bee API base URL (no trailing slash). `NEXT_PUBLIC_` is inlined at build time so the
 * browser bundle can reach the API. Defaults to the local dev API.
 */
export const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
