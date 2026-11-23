// @ts-check

/**
 * Public in-process API of chat. Other modules call only this.
 * - `isActiveRecently(userId)`: whether the user had a live socket in the last minute. Only
 *   this coarse signal leaves chat (presence details never do).
 * @param {{ presence: import('./ports.js').Presence }} handlers
 */
export function createChatApi({ presence }) {
  return { isActiveRecently: (/** @type {string} */ userId) => presence.isOnline(userId) };
}
