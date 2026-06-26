import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './token-store';

const ACCESS_KEY = 'bluebee.accessToken';
const REFRESH_KEY = 'bluebee.refreshToken';

/**
 * Production token store — the OS keychain/keystore via expo-secure-store (PRD §8.1: tokens NEVER in
 * plain AsyncStorage). Kept in its own file so the pure `TokenStore`/`MemoryTokenStore` (and thus the
 * ApiClient) stay importable under Node for the integration proof, without pulling in a native module.
 * Same keys as the driver/customer apps (a device runs one Blue Bee app at a time).
 */
export class SecureTokenStore implements TokenStore {
  getAccess(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_KEY);
  }
  getRefresh(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_KEY);
  }
  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
  }
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
}
