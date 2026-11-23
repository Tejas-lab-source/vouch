// @ts-check
import { adminListAuditLog } from '@vouch/api-client';

/**
 * The newest audit entry about a target (or of all), or null.
 * @param {import('@vouch/api-client').ApiClient} client
 * @param {string | null} targetId
 */
export async function newestAuditEntry(client, targetId) {
  const page = await adminListAuditLog(client, {
    query: { limit: 1, ...(targetId ? { targetId } : {}) },
  });
  return page.items.at(0) ?? null;
}

/**
 * Waits for the audit entry an action wrote. Entries are stored from the outbox a moment after
 * the action commits (ADR 0025), so this polls until the newest entry about the target is no
 * longer `before` (the newest one read before the action). Null when none arrives in time.
 * @param {import('@vouch/api-client').ApiClient} client
 * @param {{ targetId: string | null, beforeId: string | null, tries?: number, delayMs?: number }} options
 */
export async function awaitAuditEntry(client, { targetId, beforeId, tries = 15, delayMs = 200 }) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const entry = await newestAuditEntry(client, targetId);
    if (entry && entry.id !== beforeId) return entry;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}
