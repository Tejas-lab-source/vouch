// @ts-check
import { startTestPostgres } from '@vouch/config/test/containers';
import postgres from 'postgres';
import { migrate } from '../../migrations/run.js';

/** Generous timeout for hooks that start a container and run migrations. */
export const DB_HOOK_TIMEOUT_MS = 180_000;

/** Module roles created by the migrations (discovery reads views only). */
export const MODULE_ROLES = /** @type {const} */ ({
  platform: 'vouch_platform',
  identity: 'vouch_identity',
  profiles: 'vouch_profiles',
  media: 'vouch_media',
  safety: 'vouch_safety',
  matching: 'vouch_matching',
  chat: 'vouch_chat',
  notifications: 'vouch_notifications',
  admin: 'vouch_admin',
});

export const PUBLISHED_VIEWS = [
  'identity.active_users_v',
  'matching.likes_in_v',
  'matching.seen_v',
  'platform.colleges_v',
  'profiles.candidates_v',
  'safety.block_pairs_v',
];

/**
 * @typedef {object} TestDatabase
 * @property {string} url  Superuser URL (the role that ran the migrations).
 * @property {import('postgres').Sql} sql  Superuser client.
 * @property {() => Promise<void>} stop  Closes the client and removes the container.
 */

/**
 * Starts Postgres 17 and applies every migration.
 * @param {{ migrated?: boolean }} [options]  `migrated: false` skips the migrations.
 * @returns {Promise<TestDatabase>}
 */
export async function startDatabase({ migrated = true } = {}) {
  const pg = await startTestPostgres();
  if (migrated) await migrate({ databaseUrl: pg.url, direction: 'up' });
  const sql = postgres(pg.url, { max: 4, connect_timeout: 10, onnotice: () => {} });
  return {
    url: pg.url,
    sql,
    stop: async () => {
      await sql.end({ timeout: 5 });
      await pg.stop();
    },
  };
}

const ROLLBACK = Symbol('rollback');

/**
 * Runs `fn` in a transaction as `role`, then always rolls back.
 * Errors thrown by `fn` (for example permission denied) propagate to the caller.
 * @template T
 * @param {import('postgres').Sql} sql
 * @param {string} role  One of the vouch_* roles.
 * @param {(tx: import('postgres').TransactionSql) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function asRole(sql, role, fn) {
  if (!/^vouch_[a-z]+$/.test(role)) throw new Error(`unexpected role name: ${role}`);
  /** @type {T | undefined} */
  let result;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      result = await fn(tx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return /** @type {T} */ (result);
}
