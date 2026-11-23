// @ts-check
import { createAdminStores } from '../pg/stores.js';

/**
 * @param {ReturnType<typeof import('../../application/admin.js').makeAdmin>} admin
 * @returns {Map<string, import('../../../../platform/events/consume.js').EventHandler>}
 */
export function adminEventHandlers(admin) {
  return new Map([
    [
      'audit.recorded.v1',
      (p, { tx }) => admin.onAuditRecorded(p, { stores: createAdminStores(tx) }),
    ],
  ]);
}
