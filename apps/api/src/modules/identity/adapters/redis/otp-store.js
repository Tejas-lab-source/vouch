// @ts-check

const INCREMENT_IF_EXISTS = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('HINCRBY', KEYS[1], 'attempts', 1)
end
return false`;

/**
 * One-time codes in Redis: hash `identity:otp:{emailHmacHex}` with `codeHash` and `attempts`,
 * expiring after the OTP lifetime. Commands throw when Redis is unavailable (callers fail
 * closed).
 * @param {{ redis: import('ioredis').Redis }} deps
 * @returns {import('../../ports.js').OtpStore}
 */
export function createOtpStore({ redis }) {
  const keyOf = (/** @type {string} */ key) => `identity:otp:${key}`;
  return {
    async save(key, codeHash, ttlMs) {
      await redis
        .multi()
        .del(keyOf(key))
        .hset(keyOf(key), { codeHash, attempts: 0 })
        .pexpire(keyOf(key), ttlMs)
        .exec()
        .then(failOnError);
    },
    async get(key) {
      const record = await redis.hgetall(keyOf(key));
      if (!record.codeHash) return null;
      return { codeHash: record.codeHash, attempts: Number(record.attempts ?? 0) };
    },
    async addFailedAttempt(key) {
      // Only counts while the code exists, so an expired key is never recreated without a TTL.
      const attempts = await redis.eval(INCREMENT_IF_EXISTS, 1, keyOf(key));
      return attempts === null ? Number.MAX_SAFE_INTEGER : Number(attempts);
    },
    async consume(key) {
      return (await redis.del(keyOf(key))) === 1;
    },
  };
}

/** @param {[Error | null, unknown][] | null} replies */
function failOnError(replies) {
  const failed = (replies ?? []).find(([err]) => err);
  if (failed) throw failed[0];
}
