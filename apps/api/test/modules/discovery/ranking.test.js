// @ts-check
import { describe, expect, it } from 'vitest';
import { createHandTunedRanker } from '../../../src/modules/discovery/adapters/ranker/hand-tuned.js';
import { diversify, rank } from '../../../src/modules/discovery/domain/ranking.js';

const SETTINGS = {
  weightBase: 0.25,
  weightRecency: 0.35,
  weightCompleteness: 0.15,
  weightNewUser: 0.25,
  recencyHalfLifeHours: 72,
  newUserDays: 7,
  exposureCap: 300,
  maxNewUsersTop10: 3,
  maxPhotos: 6,
};

/**
 * @param {string} userId
 * @param {{ recency?: number, completeness?: number, newUser?: number, cap?: number, college?: string }} s
 */
const entry = (
  userId,
  { recency = 0, completeness = 0, newUser = 0, cap = 1, college = 'c1' } = {},
) => ({
  candidate: { userId, collegeId: college },
  scores: new Map([
    ['discovery.recency', { score: recency, reason: 'r' }],
    ['discovery.completeness', { score: completeness, reason: 'c' }],
    ['discovery.newUser', { score: newUser, reason: 'n' }],
    ['discovery.exposureCap', { score: cap, reason: 'x' }],
  ]),
});

describe('HandTunedRanker', () => {
  const ranker = createHandTunedRanker(SETTINGS);

  it('total = base + Σ weight × score, highest first, with every scorer reason', () => {
    const [top, second] = ranker.rank([
      entry('a', { recency: 0.2 }),
      entry('b', { recency: 1, completeness: 1, college: 'c2' }),
    ]);
    expect(top?.userId).toBe('b');
    expect(top?.total).toBeCloseTo(0.25 + 0.35 + 0.15);
    expect(second?.total).toBeCloseTo(0.25 + 0.35 * 0.2);
    expect(top?.reasons).toEqual([
      'discovery.recency=1.00 (r)',
      'discovery.completeness=1.00 (c)',
      'discovery.newUser=0.00 (n)',
      'discovery.exposureCap=1.00 (x)',
    ]);
  });

  it('the exposure cap is a gate: a capped candidate leaves the deck however well it scores', () => {
    const ranked = ranker.rank([entry('capped', { recency: 1, cap: 0 }), entry('ok')]);
    expect(ranked.map((r) => r.userId)).toEqual(['ok']);
  });

  it('keeps at most 50', () => {
    const many = Array.from({ length: 80 }, (_, i) => entry(`u${i}`, { recency: i / 80 }));
    expect(ranker.rank(many)).toHaveLength(50);
  });

  it('weights come from config', () => {
    const recencyOnly = createHandTunedRanker({ ...SETTINGS, weightCompleteness: 0 });
    const [top] = recencyOnly.rank([
      entry('complete', { completeness: 1 }),
      entry('recent', { recency: 0.1, college: 'c2' }),
    ]);
    expect(top?.userId).toBe('recent');
  });
});

describe('diversification of the first 10 slots', () => {
  /** @param {string} userId @param {string} collegeId @param {boolean} [isNew] */
  const r = (userId, collegeId, isNew = false) => ({
    userId,
    collegeId,
    isNew,
    total: 1,
    reasons: [],
  });

  it('avoids two cards in a row from the same college when another fits', () => {
    const out = diversify([r('a', 'x'), r('b', 'x'), r('c', 'y'), r('d', 'x')], {
      maxNewUsersTop: 3,
      diversifySlots: 10,
    });
    expect(out.map((o) => o.userId)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('allows at most 3 boosted new users in the first slots; the rest move down', () => {
    const ranked = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id, i) => r(id, `c${i}`, true));
    const out = diversify([...ranked, r('old', 'z')], { maxNewUsersTop: 3, diversifySlots: 4 });
    expect(out.map((o) => o.userId)).toEqual(['n1', 'n2', 'n3', 'old', 'n4', 'n5']);
  });

  it('takes the best remaining card when nothing fits, and keeps later slots in rank order', () => {
    const out = diversify([r('a', 'x'), r('b', 'x'), r('c', 'x')], {
      maxNewUsersTop: 3,
      diversifySlots: 2,
    });
    expect(out.map((o) => o.userId)).toEqual(['a', 'b', 'c']);
  });

  it('rank() applies diversification to the sorted list', () => {
    const ranked = rank(
      [
        entry('a', { recency: 1 }),
        entry('b', { recency: 0.9 }),
        entry('c', { recency: 0.1, college: 'c2' }),
      ],
      {
        base: 0,
        weights: new Map([['discovery.recency', 1]]),
        gates: ['discovery.exposureCap'],
        newUserScorer: 'discovery.newUser',
        maxNewUsersTop: 3,
        diversifySlots: 10,
        size: 50,
      },
    );
    expect(ranked.map((x) => x.userId)).toEqual(['a', 'c', 'b']);
  });
});
