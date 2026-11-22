// @ts-check
import { describe, expect, it } from 'vitest';
import { excludeBufferedPasses } from '../../../src/modules/matching/adapters/pipeline/exclude-buffered-passes.js';
import { makePassBatching } from '../../../src/modules/matching/application/passes.js';
import { decodeCursor, encodeCursor } from '../../../src/modules/matching/domain/cursor.js';
import {
  canonicalPair,
  decideMatch,
  judgeUnmatch,
  otherUser,
} from '../../../src/modules/matching/domain/pair.js';

const A = '01936f3e-8a4b-7c2d-9e1f-00000000000a';
const B = '01936f3e-8a4b-7c2d-9e1f-00000000000b';

describe('pair rules', () => {
  it('canonicalPair orders the pair the same way from either side', () => {
    expect(canonicalPair(B, A)).toEqual([A, B]);
    expect(canonicalPair(A, B)).toEqual([A, B]);
    expect(() => canonicalPair(A, A)).toThrow();
  });

  it('decideMatch: a block wins; a like back matches unless the pair was ever unmatched', () => {
    expect(decideMatch({ blocked: true, reverseLike: true, previouslyUnmatched: false })).toBe(
      'blocked',
    );
    expect(decideMatch({ blocked: false, reverseLike: true, previouslyUnmatched: false })).toBe(
      'match',
    );
    expect(decideMatch({ blocked: false, reverseLike: false, previouslyUnmatched: false })).toBe(
      'none',
    );
    expect(decideMatch({ blocked: false, reverseLike: true, previouslyUnmatched: true })).toBe(
      'none',
    );
  });

  it('only members unmatch; unmatch is permanent and idempotent', () => {
    const match = { userLow: A, userHigh: B, unmatchedAt: null, anonymisedAt: null };
    expect(judgeUnmatch(match, A)).toBe('unmatch');
    expect(judgeUnmatch(match, '01936f3e-8a4b-7c2d-9e1f-00000000000c')).toBe('not_member');
    expect(judgeUnmatch({ ...match, unmatchedAt: new Date() }, B)).toBe('already');
    expect(judgeUnmatch({ ...match, anonymisedAt: new Date() }, B)).toBe('gone');
    expect(otherUser(match, A)).toBe(B);
  });

  it('cursors round-trip and malformed ones are ignored', () => {
    const row = { createdAt: new Date('2026-11-22T10:00:00Z'), id: A };
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
    expect(decodeCursor('bm90LWEtY3Vyc29y')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe('pass batching', () => {
  it('flush moves the buffer into write jobs of at most 500 passes', async () => {
    const buffer = Array.from({ length: 1201 }, (_, i) => ({
      swiperId: A,
      targetId: `t${i}`,
      swipedAt: '2026-11-22T10:00:00.000Z',
    }));
    /** @type {number[]} */
    const jobs = [];
    const batching = makePassBatching({
      uow: /** @type {any} */ ({}),
      passes: /** @type {any} */ ({ take: async (/** @type {number} */ n) => buffer.splice(0, n) }),
      queue: { enqueueWrite: async (p) => void jobs.push(p.length), enqueueFlush: async () => {} },
    });
    expect(await batching.flushPasses()).toEqual({ moved: 1201 });
    expect(jobs).toEqual([500, 500, 201]);
    expect(await batching.flushPasses()).toEqual({ moved: 0 });
  });

  it('writing a batch is one statement, then the pending entries are settled', async () => {
    /** @type {any[]} */
    const calls = [];
    const batch = [{ swiperId: A, targetId: B, swipedAt: '2026-11-22T10:00:00.000Z' }];
    const batching = makePassBatching({
      uow: /** @type {any} */ ({
        run: (/** @type {any} */ fn) =>
          fn({
            stores: {
              swipes: {
                insertPasses: async (/** @type {any} */ p) => (calls.push(['insert', p.length]), 1),
              },
            },
          }),
      }),
      passes: /** @type {any} */ ({
        settle: async (/** @type {any} */ p) => void calls.push(['settle', p.length]),
      }),
      queue: /** @type {any} */ ({}),
    });
    expect(await batching.writePassesBatch({ passes: batch })).toEqual({ written: 1 });
    expect(calls).toEqual([
      ['insert', 1],
      ['settle', 1],
    ]);
  });

  it('the contributed deck filter excludes people still in the viewer’s pass buffer', async () => {
    const step = excludeBufferedPasses({ pendingFor: async () => new Set([B]) });
    const out = await step.run({
      viewer: { userId: A },
      candidates: [{ userId: B }, { userId: 'c' }],
    });
    expect(out).toEqual({
      candidates: [{ userId: 'c' }],
      removed: [{ userId: B, reason: 'passed' }],
    });
    expect(step.timeoutMs).toBe(250);
  });
});
