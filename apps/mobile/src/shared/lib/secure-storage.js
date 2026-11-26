// @ts-check
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'vouch.refreshToken';

/** The browser's sessionStorage (web export only). */
const session = () => /** @type {any} */ (globalThis).sessionStorage;

/**
 * The refresh token in the platform keystore (iOS Keychain, Android Keystore), readable only
 * after the device is first unlocked. The access token never leaves memory.
 *
 * The Expo web export exists only for design screenshots (docs/design/; the web product is
 * apps/web). A browser has no keystore, so there the token lives in sessionStorage for the tab.
 * @type {import('@vouch/api-client').TokenStorage}
 */
export const secureTokenStorage =
  Platform.OS === 'web'
    ? {
        get: async () => session().getItem(KEY),
        set: async (token) => session().setItem(KEY, token),
        clear: async () => session().removeItem(KEY),
      }
    : {
        get: () => SecureStore.getItemAsync(KEY),
        set: (token) =>
          SecureStore.setItemAsync(KEY, token, {
            keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
          }),
        clear: () => SecureStore.deleteItemAsync(KEY),
      };
