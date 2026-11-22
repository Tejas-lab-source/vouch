// @ts-check
import { profileUpdated } from '@vouch/contracts';
import { missingRequirements, nextStatus } from '../domain/profile.js';

/**
 * @typedef {'name' | 'gender' | 'interestedIn' | 'bio' | 'ageRange' | 'photos' | 'sections' | 'status'} ChangedField
 */

/**
 * A transaction that can save profile changes and emit events: a unit of work in use cases, or
 * an event consumer's transaction.
 * @typedef {object} ChangeScope
 * @property {import('../ports.js').ProfilesStores} stores
 * @property {(event: import('@vouch/contracts').EventDefinition, payload: unknown) => Promise<number>} emit
 */

/**
 * Applies a change to a locked profile: recomputes completeness and status, saves, and emits
 * `profile.updated.v1` in the same transaction. Every profile change goes through here.
 * @param {ChangeScope} scope
 * @param {import('../ports.js').ProfileRecord} profile  The locked row, with edits applied.
 * @param {ChangedField[]} changed
 * @param {Date} at
 * @returns {Promise<import('../ports.js').ProfileRecord>}
 */
export async function applyChange({ stores, emit }, profile, changed, at) {
  const photos = await stores.photos.listForUser(profile.userId);
  const approved = photos.filter((p) => p.status === 'approved').length;
  const status = nextStatus(profile.status, missingRequirements(profile, approved));
  const next = { ...profile, status };
  await stores.profiles.update(profile.userId, next, at);
  const fields = status === profile.status ? changed : [...new Set([...changed, 'status'])];
  await emit(profileUpdated, {
    userId: profile.userId,
    status,
    changed: /** @type {ChangedField[]} */ (fields),
    updatedAt: at.toISOString(),
  });
  return next;
}
