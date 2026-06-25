/**
 * Where the access + refresh tokens live. Injected into the ApiClient so the SAME client logic runs
 * in the app (backed by the OS keychain — see `secure-token-store.ts`) AND in the headless
 * integration proof (backed by memory). This file is PURE (no native imports) so it loads under Node.
 */
export interface TokenStore {
  getAccess(): Promise<string | null>;
  getRefresh(): Promise<string | null>;
  setTokens(accessToken: string, refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory store for tests + the Node integration proof (no native keychain there). */
export class MemoryTokenStore implements TokenStore {
  private access: string | null = null;
  private refresh: string | null = null;
  async getAccess(): Promise<string | null> {
    return this.access;
  }
  async getRefresh(): Promise<string | null> {
    return this.refresh;
  }
  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    this.access = accessToken;
    this.refresh = refreshToken;
  }
  async clear(): Promise<void> {
    this.access = null;
    this.refresh = null;
  }
}
