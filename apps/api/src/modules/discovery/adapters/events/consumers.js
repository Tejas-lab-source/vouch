// @ts-check

/**
 * Event handlers for discovery's consumers (inbox transaction as `vouch_discovery`; the work
 * itself is on Redis and idempotent).
 * @param {ReturnType<typeof import('../../application/consumers.js').makeDiscoveryConsumers>} consumers
 * @returns {Map<string, import('../../../../platform/events/consume.js').EventHandler>}
 */
export function discoveryEventHandlers(consumers) {
  return new Map([
    ['user.blocked.v1', (payload) => consumers.onUserBlocked(payload)],
    ['match.created.v1', (payload) => consumers.onMatchCreated(payload)],
    ['profile.updated.v1', async (payload) => void (await consumers.onProfileUpdated(payload))],
    ['photo.approved.v1', (payload) => consumers.onPhotoApproved(payload)],
  ]);
}
