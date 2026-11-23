// @ts-check

/**
 * @typedef {object} EventHub  Fan-out of realtime server events (`match.new`, …) to screens.
 *   The realtime client's `onEvent` calls `emit`; screens `subscribe`.
 * @property {(event: string, payload: unknown) => void} emit
 * @property {(listener: (event: string, payload: any) => void) => () => void} subscribe
 */

/** @returns {EventHub} */
export function createEventHub() {
  /** @type {Set<(event: string, payload: any) => void>} */
  const listeners = new Set();
  return {
    emit(event, payload) {
      for (const listener of [...listeners]) listener(event, payload);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
