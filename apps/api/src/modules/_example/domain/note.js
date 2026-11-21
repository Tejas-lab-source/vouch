// @ts-check

/**
 * Normalises a note's text: trims and collapses whitespace. Pure: no I/O.
 * @param {string} text
 * @returns {string}
 */
export function normaliseNote(text) {
  return text.trim().replace(/\s+/g, ' ');
}
