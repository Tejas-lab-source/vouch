// @ts-check

/**
 * Public in-process API of notifications. Other modules call only this.
 * - `queue({ userId, template, params, dedupeKey })`: queue a push from a registered template
 *   (preferences and quiet hours apply). No module needs it in v1; it is the extension point
 *   for later features' notifications.
 * @param {{ queue: Function }} handlers
 */
export function createNotificationsApi({ queue }) {
  return { queue };
}
