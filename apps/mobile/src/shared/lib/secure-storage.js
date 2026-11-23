// @ts-check
import * as SecureStore from 'expo-secure-store';

const KEY = 'vouch.refreshToken';

/**
 * The refresh token in the platform keystore (iOS Keychain, Android Keystore), readable only
 * after the device is first unlocked. The access token never leaves memory.
 * @type {import('@vouch/api-client').TokenStorage}
 */
export const secureTokenStorage = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token) =>
    SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
