// @ts-check
import { z } from 'zod';
import { Timestamp, Uuidv7 } from '../common/ids.js';
import { defineEvent } from './envelope.js';

/**
 * One staff action, recorded in the same transaction as the change it describes (Phase 14,
 * ADR 0025): whichever module makes the change emits this event through its outbox, and the
 * admin module writes it to `admin.audit_log`. A change and its audit entry therefore commit
 * together or not at all. Never carries personal data (ids, codes and counts only).
 */
export const adminActionRecorded = defineEvent({
  name: 'audit.recorded.v1',
  producer: 'admin',
  description:
    'A staff action, emitted in the transaction that made the change (by the module that made ' +
    'it); the admin module stores it in the audit log, idempotent on auditId.',
  payload: z.strictObject({
    auditId: Uuidv7,
    actorId: Uuidv7.describe('The staff member (admin.admin_users id).'),
    action: z.string().regex(/^[a-z][a-z_.]{2,79}$/),
    targetType: z.string().min(1).max(40),
    targetId: z.string().min(1).max(64),
    details: z.record(z.string(), z.unknown()),
    requestId: z.string().max(100).nullable(),
    occurredAt: Timestamp,
  }),
});

export const adminEvents = [adminActionRecorded];
