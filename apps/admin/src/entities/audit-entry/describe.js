// @ts-check
import { t } from '@vouch/i18n';

/** @typedef {{ id: string, actorName: string, action: string, targetType: string, targetId: string, createdAt: string }} AuditEntry */

/** One audit entry as a readable line. */
/** @param {AuditEntry} e */
export const describeAudit = (e) =>
  t('admin.audit.entry', {
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    actor: e.actorName,
    when: new Date(e.createdAt).toLocaleString(),
  });
