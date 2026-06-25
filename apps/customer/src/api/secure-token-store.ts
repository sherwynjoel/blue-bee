import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from '@blue-bee/api-client';

const ACCESS_KEY = 'bluebee.accessToken';
const REFRESH_KEY = 'bluebee.refreshToken';

/**
 * Production token store — the OS keychain/keystore via expo-secure-store (PRD §8.1: tokens NEVER in
 * plain AsyncStorage). The pure `TokenStore` interface + the transport live in `@blue-bee/api-client`;
 * this native impl is kept app-local so that package's entry stays Node-importable (for the headless
 * integration proof, which uses `MemoryTokenStore`). Same keys as the driver app.
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
