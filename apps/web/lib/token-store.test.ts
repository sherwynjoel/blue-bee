import { WebTokenStore } from './token-store';

describe('WebTokenStore (web token strategy)', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps the access token in MEMORY only and the refresh token in localStorage', async () => {
    const store = new WebTokenStore();
    await store.setTokens('access-xyz', 'refresh-abc');
    expect(await store.getAccess()).toBe('access-xyz');
    expect(await store.getRefresh()).toBe('refresh-abc');
    expect(window.localStorage.getItem('bb.console.refresh')).toBe('refresh-abc');
    // The access token is NEVER persisted (XSS can't read it from disk; a closed tab drops it).
    expect(JSON.stringify(window.localStorage)).not.toContain('access-xyz');
  });

  it('clear() wipes both the in-memory access and the persisted refresh', async () => {
    const store = new WebTokenStore();
    await store.setTokens('a', 'r');
    await store.clear();
    expect(await store.getAccess()).toBeNull();
    expect(await store.getRefresh()).toBeNull();
    expect(window.localStorage.getItem('bb.console.refresh')).toBeNull();
  });

  it('a reload (fresh store) has NO access in memory but re-reads the refresh from localStorage', async () => {
    const before = new WebTokenStore();
    await before.setTokens('a', 'r');
    const afterReload = new WebTokenStore(); // a new instance models a page reload
    expect(await afterReload.getAccess()).toBeNull(); // → the api-client refreshes on first 401
    expect(await afterReload.getRefresh()).toBe('r');
  });
});
