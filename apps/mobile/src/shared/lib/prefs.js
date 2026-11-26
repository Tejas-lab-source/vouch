// @ts-check
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** The browser's sessionStorage (web export only). */
const session = () => /** @type {any} */ (globalThis).sessionStorage;

/** SecureStore keys allow letters, digits, ".", "-" and "_". @param {string} key */
const safe = (key) => key.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Small non-personal preferences (onboarding step names) in the platform's secure store; in
 * sessionStorage on the design-screenshot web export (see secure-storage.js).
 * @type {import('@vouch/features-core').Prefs}
 */
export const securePrefs =
  Platform.OS === 'web'
    ? {
        get: async (key) => session().getItem(safe(key)),
        set: async (key, value) => session().setItem(safe(key), value),
      }
    : {
        get: async (key) => SecureStore.getItemAsync(safe(key)),
        set: async (key, value) => SecureStore.setItemAsync(safe(key), value),
      };
