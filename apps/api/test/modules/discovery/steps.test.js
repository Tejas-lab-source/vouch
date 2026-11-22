// @ts-check
import { describe, expect, it } from 'vitest';
import { excludeBlocked } from '../../../src/modules/discovery/application/filters/exclude-blocked.js';
import { excludeInactive } from '../../../src/modules/discovery/application/filters/exclude-inactive.js';
import { excludeSelf } from '../../../src/modules/discovery/application/filters/exclude-self.js';
import { excludeSwiped } from '../../../src/modules/discovery/application/filters/exclude-swiped.js';
import { mutualPreferences } from '../../../src/modules/discovery/application/filters/mutual-preferences.js';
import { completeness } from '../../../src/modules/discovery/application/scorers/completeness.js';
import { exposureCap } from '../../../src/modules/discovery/application/scorers/exposure-cap.js';
import { newUser } from '../../../src/modules/discovery/application/scorers/new-user.js';
import { recency } from '../../../src/modules/discovery/application/scorers/recency.js';
import { mutuallyInterested } from '../../../src/modules/discovery/domain/deck.js';

const NOW = new Date('2026-11-22T12:00:00Z');
const clock = { now: () => NOW };
let n = 0;
/** @param {Partial<import('../../../src/modules/discovery/ports.js').Candidate>} [over] */
const person = (over = {}) => ({
  userId: `01936f3e-8a4b-7c2d-9e1f-${String(++n).padStart(12, '0')}`,
  collegeId: '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f',
  gender: 0,
  interestedIn: [1],
  age: 21,
  minAge: 18,
  maxAge: 30,
  lastActiveAt: NOW.toISOString(),
  createdAt: '2026-10-01T00:00:00.000Z',
  approvedPhotos: 3,
  ...over,
});
const VIEWER = { ...person({ gender: 1, interestedIn: [0] }), clusterId: 'k' };

/** @param {any} step @param {any[]} candidates */
const kept = async (step, candidates) =>
  (await step.run({ viewer: VIEWER, candidates })).candidates.map(
    (/** @type {any} */ c) => c.userId,
  );

describe('candidate filters (each reports what it removed)', () => {
  it('excludeSelf', async () => {
    const other = person();
    const out = await excludeSelf().run({ viewer: VIEWER, candidates: [VIEWER, other] });
    expect(out.candidates.map((/** @type {any} */ c) => c.userId)).toEqual([other.userId]);
    expect(out.removed).toEqual([{ userId: VIEWER.userId, reason: 'self' }]);
  });

  it('excludeSwiped asks once for the whole list', async () => {
    const [a, b] = [person(), person()];
    /** @type {any[]} */
    const asked = [];
    const step = excludeSwiped({
      swipedAmong: async (viewerId, ids) => {
        asked.push({ viewerId, ids });
        return new Set([a.userId]);
      },
    });
    expect(await kept(step, [a, b])).toEqual([b.userId]);
    expect(asked).toEqual([{ viewerId: VIEWER.userId, ids: [a.userId, b.userId] }]);
  });

  it('excludeBlocked and excludeInactive (banned)', async () => {
    const [a, b, c] = [person(), person(), person()];
    expect(
      await kept(excludeBlocked({ blockedAmong: async () => new Set([b.userId]) }), [a, b, c]),
    ).toEqual([a.userId, c.userId]);
    expect(
      await kept(excludeInactive({ bannedAmong: async () => new Set([c.userId]) }), [a, b, c]),
    ).toEqual([a.userId, b.userId]);
  });

  it('mutualPreferences needs gender and age to fit both ways', async () => {
    const fits = person();
    const wrongGender = person({ gender: 1 });
    const notInterestedBack = person({ interestedIn: [0] });
    const tooYoungForViewer = person({ age: 19 });
    const viewerTooOld = person({ maxAge: 20 });
    const viewer = { ...VIEWER, minAge: 20 };
    const out = await mutualPreferences().run({
      viewer,
      candidates: [fits, wrongGender, notInterestedBack, tooYoungForViewer, viewerTooOld],
    });
    expect(out.candidates.map((/** @type {any} */ c) => c.userId)).toEqual([fits.userId]);
    expect(mutuallyInterested(viewer, fits)).toBe(true);
  });
});

describe('scorers (score in 0–1 with a reason)', () => {
  it('recency halves every half-life', () => {
    const step = recency({ clock, halfLifeHours: 72 });
    const at = (/** @type {number} */ hours) =>
      step.run({
        candidate: person({ lastActiveAt: new Date(NOW.getTime() - hours * 3.6e6).toISOString() }),
      });
    expect(at(0)).toEqual({ score: 1, reason: 'active 0 h ago' });
    expect(at(72).score).toBeCloseTo(0.5);
    expect(at(144).score).toBeCloseTo(0.25);
  });

  it('completeness counts approved photos out of the maximum', () => {
    const step = completeness({ maxPhotos: 6 });
    expect(step.run({ candidate: person({ approvedPhotos: 3 }) })).toEqual({
      score: 0.5,
      reason: '3/6 photos',
    });
    expect(step.run({ candidate: person({ approvedPhotos: 9 }) }).score).toBe(1);
  });

  it('new users get a boost that fades over 7 days', () => {
    const step = newUser({ clock, days: 7 });
    const joined = (/** @type {number} */ days) =>
      step.run({
        candidate: person({ createdAt: new Date(NOW.getTime() - days * 864e5).toISOString() }),
      });
    expect(joined(0).score).toBe(1);
    expect(joined(3.5).score).toBeCloseTo(0.5);
    expect(joined(7)).toEqual({ score: 0, reason: 'established' });
  });

  it('the exposure cap is 1 below the cap and 0 at it', () => {
    const counts = new Map();
    const step = exposureCap({ cap: 300, counts: () => counts });
    const candidate = person();
    expect(step.run({ candidate })).toEqual({ score: 1, reason: 'shown 0/300 today' });
    counts.set(candidate.userId, 300);
    expect(step.run({ candidate })).toEqual({ score: 0, reason: 'shown 300/300 today' });
  });
});
