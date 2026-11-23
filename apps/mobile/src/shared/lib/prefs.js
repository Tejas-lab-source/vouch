// @ts-check
import * as SecureStore from 'expo-secure-store';

/** SecureStore keys allow letters, digits, ".", "-" and "_". @param {string} key */
const safe = (key) => key.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Small non-personal preferences (onboarding step names) in the platform's secure store.
 * @type {import('@vouch/features-core').Prefs}
 */
export const securePrefs = {
  get: async (key) => SecureStore.getItemAsync(safe(key)),
  set: async (key, value) => SecureStore.setItemAsync(safe(key), value),
};
