import { WebTokenStore } from './token-store';

describe('WebTokenStore (web token strategy — httpOnly cookie for refresh)', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps the access token in MEMORY only and NEVER persists the refresh token', async () => {
    const store = new WebTokenStore();
    await store.setTokens('access-xyz', 'refresh-abc');
    expect(await store.getAccess()).toBe('access-xyz');
    // The refresh token now lives ONLY in an httpOnly cookie the server owns — JS can never read it,
    // so getRefresh() always resolves null and NOTHING is written to localStorage.
    expect(await store.getRefresh()).toBeNull();
    expect(window.localStorage.getItem('bb.console.refresh')).toBeNull();
    // Neither token ever touches disk (XSS can't read either from localStorage; a closed tab drops the access token).
    expect(JSON.stringify(window.localStorage)).not.toContain('access-xyz');
    expect(JSON.stringify(window.localStorage)).not.toContain('refresh-abc');
  });

  it('getRefresh() always resolves null — even when setTokens was handed a token value', async () => {
    const store = new WebTokenStore();
    // At runtime a trusted browser origin gets `refreshToken` omitted from the body (arrives as undefined);
    // even if a value were passed, it must be ignored — the cookie is authoritative.
    await store.setTokens('a', 'r');
    expect(await store.getRefresh()).toBeNull();
  });

  it('clear() resets the in-memory access token and writes nothing to localStorage', async () => {
    const store = new WebTokenStore();
    await store.setTokens('a', 'r');
    await store.clear();
    expect(await store.getAccess()).toBeNull();
    expect(await store.getRefresh()).toBeNull();
    expect(window.localStorage.getItem('bb.console.refresh')).toBeNull();
  });

  it('a reload (fresh store) has NO access in memory and NO JS-readable refresh (the cookie refreshes on first 401)', async () => {
    const before = new WebTokenStore();
    await before.setTokens('a', 'r');
    const afterReload = new WebTokenStore(); // a new instance models a page reload
    expect(await afterReload.getAccess()).toBeNull(); // → the api-client refreshes on first 401...
    expect(await afterReload.getRefresh()).toBeNull(); // ...via the httpOnly cookie, not a JS-held token
  });
});
