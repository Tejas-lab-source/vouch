// @ts-check

/**
 * Small non-personal preferences in localStorage (the onboarding step names). Storage can be
 * unavailable (private mode, blocked site data), so every access is guarded and falls back
 * to memory.
 * @returns {import('@vouch/features-core').Prefs}
 */
export function createLocalPrefs() {
  /** @type {Map<string, string>} */
  const memory = new Map();
  return {
    get: async (key) => {
      try {
        return globalThis.localStorage.getItem(key) ?? memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set: async (key, value) => {
      memory.set(key, value);
      try {
        globalThis.localStorage.setItem(key, value);
      } catch {
        // memory only
      }
    },
  };
}
