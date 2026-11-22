// @ts-check

/**
 * Public in-process API of discovery. Other modules call only this.
 * - `nextCards(viewerId)`: the next page of up to 10 cards (the read path behind `GET /v1/deck`).
 * - `wasServed(viewerId, targetId)`: whether the target was served to the viewer in the last
 *   24 hours (`discovery:served:{uid}`); matching validates swipes with it (Phase 8).
 * @param {{ nextCards: (viewerId: string) => Promise<{ cards: unknown[] }>, wasServed: (viewerId: string, targetId: string) => Promise<boolean> }} handlers
 */
export function createDiscoveryApi({ nextCards, wasServed }) {
  return { nextCards, wasServed };
}
