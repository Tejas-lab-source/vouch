// @ts-check
import { userBlocked } from '@vouch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/platform/db.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { lockKey, lockPair } from '../../src/platform/locks.js';
import { createUnitOfWork } from '../../src/platform/uow.js';
import { runWithContext } from '../../src/platform/context.js';
import { HOOK_TIMEOUT_MS, startInfra } from './helpers.js';

const PERMISSION_DENIED = '42501';

describe('database kernel (SET LOCAL ROLE per transaction, ADR 0010)', () => {
  /** @type {import('./helpers.js').Infra} */
  let infra;
  /** @type {import('../../src/platform/db.js').Database} */
  let db;

  beforeAll(async () => {
    infra = await startInfra();
    // max: 1 forces every transaction onto the same connection, so role leaks would show.
    db = createDatabase({ url: infra.appUrl, max: 1, statementTimeoutMs: 500 });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await infra?.stop();
  }, HOOK_TIMEOUT_MS);

  it('runs each transaction as the module role, and the login is not a superuser', async () => {
    const [row] = await db.transaction(
      'matching',
      (tx) => tx`SELECT current_user AS role, session_user AS login`,
    );
    expect(row).toEqual({ role: 'vouch_matching', login: 'vouch_app' });
    const [login] = await db.sql`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(login.rolsuper).toBe(false);
  });

  it('a module cannot write another module’s schema through the kernel', async () => {
    await expect(
      db.transaction(
        'matching',
        (tx) => tx`
        INSERT INTO chat.messages (conversation_id, seq, sender_id, client_msg_id, body)
        VALUES (${uuidv7()}, 1, ${uuidv7()}, ${uuidv7()}, 'x')`,
      ),
    ).rejects.toMatchObject({ code: PERMISSION_DENIED });
    await expect(
      db.transaction(
        'chat',
        (tx) => tx`INSERT INTO identity.consents (id, user_id, notice_version, purposes)
        VALUES (${uuidv7()}, ${uuidv7()}, 'v1', '{x}')`,
      ),
    ).rejects.toMatchObject({ code: PERMISSION_DENIED });
  });

  it('the role does not leak into the next transaction on the same connection', async () => {
    await db.transaction('identity', (tx) => tx`SELECT 1`);
    const [after] = await db.sql`SELECT current_user AS role`;
    expect(after.role).toBe('vouch_app');
    await expect(
      db.transaction('matching', (tx) => tx`SELECT count(*) FROM identity.users`),
    ).rejects.toMatchObject({ code: PERMISSION_DENIED });
    const [next] = await db.transaction('identity', (tx) => tx`SELECT current_user AS role`);
    expect(next.role).toBe('vouch_identity');
  });

  it('the role is also reset after a failed transaction', async () => {
    await db
      .transaction('matching', async (tx) => {
        await tx`SELECT 1`;
        throw new Error('rollback');
      })
      .catch(() => {});
    const [row] = await db.sql`SELECT current_user AS role`;
    expect(row.role).toBe('vouch_app');
  });

  it('db.read is read-only, and queries are bounded by the statement timeout', async () => {
    await expect(
      db.read('platform', (tx) => tx`INSERT INTO platform.feature_flags (key) VALUES ('x.y')`),
    ).rejects.toMatchObject({ code: '25006' });
    await expect(db.read('platform', (tx) => tx`SELECT pg_sleep(2)`)).rejects.toMatchObject({
      code: '57014',
    });
  });

  it('refuses modules it does not know', async () => {
    await expect(db.transaction('ghost', (tx) => tx`SELECT 1`)).rejects.toThrow(
      /unknown database module/,
    );
    await expect(db.transaction('chat; DROP', (tx) => tx`SELECT 1`)).rejects.toThrow(
      /unknown database module/,
    );
  });

  it('discovery reads views and can write the outbox and inbox (Phase 4 migration)', async () => {
    await db.read('discovery', (tx) => tx`SELECT * FROM profiles.candidates_v LIMIT 1`);
    await expect(
      db.read('discovery', (tx) => tx`SELECT * FROM profiles.profiles LIMIT 1`),
    ).rejects.toMatchObject({
      code: PERMISSION_DENIED,
    });
    await db.transaction('discovery', async (tx) => {
      await tx`INSERT INTO platform.outbox (name, version, payload) VALUES ('deck.served.v1', 1, '{}')`;
      await tx`INSERT INTO platform.inbox (consumer, event_id) VALUES ('discovery', 999999)`;
    });
  });

  describe('unit of work', () => {
    const payload = () => ({
      blockerId: uuidv7(),
      blockedId: uuidv7(),
      blockedAt: new Date().toISOString(),
    });

    it('writes the event in the same transaction, with the current trace id', async () => {
      const uow = createUnitOfWork({ db, module: 'safety' });
      const event = payload();
      const id = await runWithContext({ traceId: 'trace-abc' }, () =>
        uow.run(({ emit }) => emit(userBlocked, event)),
      );
      const [row] =
        await infra.admin`SELECT name, version, payload, trace_id FROM platform.outbox WHERE id = ${id}`;
      expect(row).toEqual({
        name: 'user.blocked.v1',
        version: 1,
        payload: event,
        trace_id: 'trace-abc',
      });
    });

    it('a rolled-back transaction leaves no outbox row', async () => {
      const uow = createUnitOfWork({ db, module: 'safety' });
      const event = payload();
      await expect(
        uow.run(async ({ emit }) => {
          await emit(userBlocked, event);
          throw new Error('business rule failed');
        }),
      ).rejects.toThrow('business rule failed');
      const rows =
        await infra.admin`SELECT id FROM platform.outbox WHERE payload->>'blockerId' = ${event.blockerId}`;
      expect(rows).toHaveLength(0);
    });

    it('refuses an event payload that breaks its contract', async () => {
      const uow = createUnitOfWork({ db, module: 'safety' });
      await expect(
        uow.run(({ emit }) => emit(userBlocked, { blockerId: 'not-a-uuid' })),
      ).rejects.toThrow(/invalid payload/);
    });

    it('binds module stores to the transaction', async () => {
      const uow = createUnitOfWork({
        db,
        module: 'safety',
        stores: (tx) => ({ who: () => tx`SELECT current_user AS role` }),
      });
      const [row] = await uow.run(({ stores }) => stores.who());
      expect(row.role).toBe('vouch_safety');
    });
  });

  it('lockPair serialises concurrent transactions on the same pair in either order', async () => {
    const pool = createDatabase({ url: infra.appUrl, max: 2 });
    const [a, b] = [uuidv7(), uuidv7()];
    /** @type {string[]} */
    const order = [];
    const holder = pool.transaction('matching', async (tx) => {
      await lockPair(tx, a, b);
      order.push('first-locked');
      await new Promise((resolve) => setTimeout(resolve, 300));
      order.push('first-done');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const waiter = pool.transaction('matching', async (tx) => {
      await lockPair(tx, b, a);
      order.push('second-locked');
    });
    await Promise.all([holder, waiter]);
    await pool.end();
    expect(order).toEqual(['first-locked', 'first-done', 'second-locked']);
  });

  it('lockKey serialises concurrent transactions on the same key only', async () => {
    const pool = createDatabase({ url: infra.appUrl, max: 3 });
    /** @type {string[]} */
    const order = [];
    const holder = pool.transaction('media', async (tx) => {
      await lockKey(tx, 'media:uploads:u1');
      order.push('first-locked');
      await new Promise((resolve) => setTimeout(resolve, 300));
      order.push('first-done');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const other = pool.transaction('media', async (tx) => {
      await lockKey(tx, 'media:uploads:u2');
      order.push('other-key');
    });
    const waiter = pool.transaction('media', async (tx) => {
      await lockKey(tx, 'media:uploads:u1');
      order.push('second-locked');
    });
    await Promise.all([holder, other, waiter]);
    await pool.end();
    // Another key is not blocked; the same key waits for the first transaction to finish.
    expect(order.indexOf('other-key')).toBeLessThan(order.indexOf('first-done'));
    expect(order.indexOf('first-done')).toBeLessThan(order.indexOf('second-locked'));
  });
});
