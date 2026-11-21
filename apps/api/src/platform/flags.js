// @ts-check
import { createHash } from 'node:crypto';
import { FlagRule } from '@vouch/contracts';
import { z } from 'zod';

export const FLAG_CACHE_KEY = 'platform:flags';
export const FLAG_CACHE_TTL_S = 30;

/**
 * Who a flag is evaluated for. Every field is optional: a signed-out caller has none.
 * @typedef {object} FlagSubject
 * @property {string} [userId]
 * @property {string} [collegeId]
 * @property {string[]} [cohorts]
 * @property {'ios' | 'android' | 'web'} [platform]
 * @property {string} [appVersion]
 */

/**
 * @typedef {object} StoredFlag
 * @property {string} key
 * @property {boolean} enabled
 * @property {z.infer<typeof FlagRule>[]} rules
 */

const StoredFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  rules: z.array(FlagRule),
});

/**
 * Compares two `x.y.z` versions.
 * @param {string} a
 * @param {string} b
 * @returns {number} negative, zero or positive
 */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa.at(i) ?? 0) - (pb.at(i) ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * A stable bucket in [0, 100) for a user and flag, so a percentage rollout keeps the same users
 * as it widens.
 * @param {string} flagKey
 * @param {string} userId
 */
export function rolloutBucket(flagKey, userId) {
  const digest = createHash('sha256').update(`${flagKey}:${userId}`).digest();
  return (digest.readUInt32BE(0) % 10_000) / 100;
}

/**
 * @param {string} flagKey
 * @param {z.infer<typeof FlagRule>} rule
 * @param {FlagSubject} subject
 */
function ruleMatches(flagKey, rule, subject) {
  switch (rule.type) {
    case 'campus':
      return subject.collegeId !== undefined && rule.collegeIds.includes(subject.collegeId);
    case 'cohort':
      return (subject.cohorts ?? []).some((cohort) => rule.cohorts.includes(cohort));
    case 'percentage':
      return subject.userId !== undefined && rolloutBucket(flagKey, subject.userId) < rule.percent;
    case 'platform':
      return subject.platform !== undefined && rule.platforms.includes(subject.platform);
    case 'minAppVersion':
      return (
        subject.appVersion !== undefined && compareVersions(subject.appVersion, rule.version) >= 0
      );
    case 'killSwitch':
      return false;
    default:
      return false;
  }
}

/**
 * Evaluates one flag: on when enabled, not killed, and every rule matches.
 * @param {StoredFlag | undefined} flag
 * @param {FlagSubject} subject
 * @returns {boolean}
 */
export function evaluateFlag(flag, subject) {
  if (!flag || !flag.enabled) return false;
  return flag.rules.every((rule) => ruleMatches(flag.key, rule, subject));
}

/**
 * Feature flags backed by `platform.feature_flags`, cached in Redis for 30 s. If Redis is
 * unavailable, flags are read from Postgres directly.
 * @param {{ db: import('./db.js').Database, redis: import('ioredis').Redis, logger: import('pino').Logger }} deps
 */
export function createFlags({ db, redis, logger }) {
  /** @returns {Promise<Map<string, StoredFlag>>} */
  const loadFromDb = async () => {
    const rows = await db.read(
      'platform',
      (tx) => tx`SELECT key, enabled, rules FROM platform.feature_flags`,
    );
    return new Map(rows.map((row) => [row.key, StoredFlagSchema.parse(row)]));
  };

  /** @returns {Promise<Map<string, StoredFlag>>} */
  const load = async () => {
    try {
      const cached = await redis.get(FLAG_CACHE_KEY);
      if (cached) {
        return new Map(
          z
            .array(StoredFlagSchema)
            .parse(JSON.parse(cached))
            .map((f) => [f.key, f]),
        );
      }
    } catch (err) {
      logger.warn({ err }, 'flag cache unavailable; reading flags from Postgres');
      return loadFromDb();
    }
    const flags = await loadFromDb();
    await redis
      .set(FLAG_CACHE_KEY, JSON.stringify([...flags.values()]), 'EX', FLAG_CACHE_TTL_S)
      .catch((err) => logger.warn({ err }, 'flag cache write failed'));
    return flags;
  };

  return {
    /**
     * @param {string} key
     * @param {FlagSubject} [subject]
     */
    async isEnabled(key, subject = {}) {
      return evaluateFlag((await load()).get(key), subject);
    },
    /**
     * Every flag evaluated for one subject (for `GET /v1/config`).
     * @param {FlagSubject} [subject]
     * @returns {Promise<Record<string, boolean>>}
     */
    async evaluateAll(subject = {}) {
      const flags = await load();
      return Object.fromEntries(
        [...flags.values()].map((flag) => [flag.key, evaluateFlag(flag, subject)]),
      );
    },
    /** Drops the cache so the next read sees changes immediately (after an admin edit). */
    async invalidate() {
      await redis.del(FLAG_CACHE_KEY);
    },
  };
}

/** @typedef {ReturnType<typeof createFlags>} Flags */
