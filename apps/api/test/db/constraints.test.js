// @ts-check
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../scripts/lib/uuidv7.js';
import { DB_HOOK_TIMEOUT_MS, startDatabase } from './helpers.js';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/**
 * Returns two fresh ids in canonical order (low < high).
 * @returns {[string, string]}
 */
function orderedPair() {
  const [a, b] = [uuidv7(), uuidv7()];
  return a < b ? [a, b] : [b, a];
}

/**
 * Returns an ISO date that is `years` years before today (UTC), plus `days` days.
 * @param {number} years
 * @param {number} [days]
 */
function yearsAgo(years, days = 0) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('table constraints', () => {
  /** @type {import('./helpers.js').TestDatabase} */
  let db;

  beforeAll(async () => {
    db = await startDatabase();
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.stop();
  }, DB_HOOK_TIMEOUT_MS);

  describe('matching.matches', () => {
    it('rejects a duplicate match pair', async () => {
      const [low, high] = orderedPair();
      await db.sql`INSERT INTO matching.matches (id, user_low, user_high) VALUES (${uuidv7()}, ${low}, ${high})`;

      await expect(
        db.sql`INSERT INTO matching.matches (id, user_low, user_high) VALUES (${uuidv7()}, ${low}, ${high})`,
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint_name: 'matches_pair_unique' });
    });

    it('rejects user_low >= user_high', async () => {
      const [low, high] = orderedPair();

      await expect(
        db.sql`INSERT INTO matching.matches (id, user_low, user_high) VALUES (${uuidv7()}, ${high}, ${low})`,
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint_name: 'matches_canonical_order',
      });
      await expect(
        db.sql`INSERT INTO matching.matches (id, user_low, user_high) VALUES (${uuidv7()}, ${low}, ${low})`,
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint_name: 'matches_canonical_order',
      });
    });
  });

  describe('chat.messages', () => {
    it('rejects a duplicate client_msg_id in one conversation', async () => {
      const [conversation, sender, clientMsgId] = [uuidv7(), uuidv7(), uuidv7()];
      await db.sql`
        INSERT INTO chat.messages (conversation_id, seq, sender_id, client_msg_id, body)
        VALUES (${conversation}, 1, ${sender}, ${clientMsgId}, 'hi')`;

      await expect(db.sql`
        INSERT INTO chat.messages (conversation_id, seq, sender_id, client_msg_id, body)
        VALUES (${conversation}, 2, ${sender}, ${clientMsgId}, 'hi again')`).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
    });

    it('allows the same client_msg_id in a different conversation', async () => {
      const [sender, clientMsgId] = [uuidv7(), uuidv7()];
      for (const conversation of [uuidv7(), uuidv7()]) {
        await db.sql`
          INSERT INTO chat.messages (conversation_id, seq, sender_id, client_msg_id, body)
          VALUES (${conversation}, 1, ${sender}, ${clientMsgId}, 'hi')`;
      }
    });
  });

  describe('identity.users', () => {
    /** @param {string} birthDate */
    const insertUser = (birthDate) => db.sql`
      INSERT INTO identity.users (id, public_id, college_id, email_hmac, birth_date)
      VALUES (${uuidv7()}, ${`pub${uuidv7().replaceAll('-', '').slice(0, 20)}`}, ${uuidv7()},
              ${randomBytes(32)}, ${birthDate})`;

    it('accepts a user who turned 18 today', async () => {
      await insertUser(yearsAgo(18));
    });

    it('rejects a user younger than 18 at sign-up', async () => {
      await expect(insertUser(yearsAgo(18, 1))).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint_name: 'users_adult_at_signup',
      });
    });
  });

  describe('other invariants', () => {
    it('rejects a swipe direction other than 1 (like) or 0 (pass), and self-swipes', async () => {
      const [a, b] = orderedPair();
      await db.sql`INSERT INTO matching.swipes (swiper_id, target_id, direction) VALUES (${a}, ${b}, 0)`;

      await expect(
        db.sql`INSERT INTO matching.swipes (swiper_id, target_id, direction) VALUES (${b}, ${a}, -1)`,
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(
        db.sql`INSERT INTO matching.swipes (swiper_id, target_id, direction) VALUES (${a}, ${a}, 1)`,
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('rejects an active profile without a name', async () => {
      await expect(db.sql`
        INSERT INTO profiles.profiles (user_id, college_id, cluster_id, gender, interested_in, birth_date, status)
        VALUES (${uuidv7()}, ${uuidv7()}, ${uuidv7()}, 1, '{0}', ${yearsAgo(20)}, 'active')`).rejects.toMatchObject(
        {
          code: CHECK_VIOLATION,
          constraint_name: 'profiles_active_complete',
        },
      );
    });

    it('allows only one active ban per user', async () => {
      const [user, admin] = [uuidv7(), uuidv7()];
      const ban = () => db.sql`
        INSERT INTO safety.bans (id, user_id, reason, created_by) VALUES (${uuidv7()}, ${user}, 'spam', ${admin})`;
      await ban();

      await expect(ban()).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });
  });
});
