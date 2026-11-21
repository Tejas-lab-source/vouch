// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/platform/ids.js';
import { DB_HOOK_TIMEOUT_MS, startDatabase } from './helpers.js';

const PARTITIONS = 16;
const ROWS = 1600;

/**
 * Collects every relation name in an EXPLAIN (FORMAT JSON) plan tree.
 * @param {any} node
 * @param {string[]} [names]
 * @returns {string[]}
 */
function relationsInPlan(node, names = []) {
  if (node && typeof node === 'object') {
    if (typeof node['Relation Name'] === 'string') names.push(node['Relation Name']);
    for (const child of node.Plans ?? []) relationsInPlan(child, names);
  }
  return names;
}

describe('hash partitioning', () => {
  /** @type {import('./helpers.js').TestDatabase} */
  let db;

  beforeAll(async () => {
    db = await startDatabase();
    const swipes = Array.from({ length: ROWS }, () => ({
      swiper_id: uuidv7(),
      target_id: uuidv7(),
      direction: 1,
    }));
    await db.sql`INSERT INTO matching.swipes ${db.sql(swipes)}`;
    const messages = Array.from({ length: ROWS }, () => ({
      conversation_id: uuidv7(),
      seq: 1,
      sender_id: uuidv7(),
      client_msg_id: uuidv7(),
      body: 'hi',
    }));
    await db.sql`INSERT INTO chat.messages ${db.sql(messages)}`;
    await db.sql`ANALYZE matching.swipes, chat.messages`;
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.stop();
  }, DB_HOOK_TIMEOUT_MS);

  it.each([
    ['matching.swipes', 'swipes_p'],
    ['chat.messages', 'messages_p'],
  ])('%s has 16 partitions and rows land in every one', async (table, prefix) => {
    const partitions = await db.sql`
      SELECT c.relname FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = ${table}::regclass ORDER BY c.relname`;
    expect(partitions).toHaveLength(PARTITIONS);

    const counts = await db.sql`
      SELECT tableoid::regclass::text AS partition, count(*)::int AS rows
      FROM ${db.sql(table.split('.')[0])}.${db.sql(table.split('.')[1])} GROUP BY 1`;
    expect(counts).toHaveLength(PARTITIONS);
    for (const row of counts) {
      expect(row.partition).toContain(prefix);
      expect(row.rows).toBeGreaterThan(0);
    }
  });

  it('a swiper_id lookup touches exactly one swipes partition', async () => {
    const [plan] = await db.sql`
      EXPLAIN (FORMAT JSON) SELECT * FROM matching.swipes
      WHERE swiper_id = ${uuidv7()}::uuid`;
    const relations = relationsInPlan(plan['QUERY PLAN'][0].Plan);

    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatch(/^swipes_p\d+$/);
  });

  it('a conversation_id lookup touches exactly one messages partition', async () => {
    const [plan] = await db.sql`
      EXPLAIN (FORMAT JSON) SELECT * FROM chat.messages
      WHERE conversation_id = ${uuidv7()}::uuid AND seq > 0 ORDER BY seq`;
    const relations = relationsInPlan(plan['QUERY PLAN'][0].Plan);

    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatch(/^messages_p\d+$/);
  });
});
