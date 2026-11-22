// @ts-check
import { en } from './en.js';

/** @typedef {keyof typeof en} MessageKey */

/** Locales shipped in v1. Others fall back to English. */
export const LOCALES = Object.freeze({ en });

/**
 * Builds a translator. `{name}` placeholders are replaced from `params`; an unknown key is a
 * programming error and throws, so a missing string is caught by tests, never shown.
 * @param {keyof typeof LOCALES} [locale]
 */
export function createTranslator(locale = 'en') {
  const messages = new Map(Object.entries(new Map(Object.entries(LOCALES)).get(locale) ?? en));
  /**
   * @param {MessageKey} key
   * @param {Record<string, string | number>} [params]
   * @returns {string}
   */
  return function t(key, params = {}) {
    const template = messages.get(key);
    if (template === undefined) throw new Error(`missing string: ${key}`);
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(params, name) ? String(new Map(Object.entries(params)).get(name)) : match,
    );
  };
}

/** The default (English) translator. */
export const t = createTranslator('en');

export { en };
