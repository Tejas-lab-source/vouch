// @ts-check
import { describe, expect, it } from 'vitest';
import { compareVersions, evaluateFlag, rolloutBucket } from '../../src/platform/flags.js';

const COLLEGE = '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f';
/** @param {any[]} rules @param {boolean} [enabled] */
const flag = (rules, enabled = true) => ({ key: 'stories.enabled', enabled, rules });

describe('evaluateFlag', () => {
  it('is off when missing or disabled, on when enabled with no rules', () => {
    expect(evaluateFlag(undefined, {})).toBe(false);
    expect(evaluateFlag(flag([], false), {})).toBe(false);
    expect(evaluateFlag(flag([]), {})).toBe(true);
  });

  it.each([
    [
      'campus',
      { type: 'campus', collegeIds: [COLLEGE] },
      { collegeId: COLLEGE },
      { collegeId: 'other' },
    ],
    [
      'cohort',
      { type: 'cohort', cohorts: ['beta'] },
      { cohorts: ['beta', 'x'] },
      { cohorts: ['x'] },
    ],
    [
      'platform',
      { type: 'platform', platforms: ['ios'] },
      { platform: 'ios' },
      { platform: 'web' },
    ],
    [
      'minAppVersion',
      { type: 'minAppVersion', version: '1.2.0' },
      { appVersion: '1.10.0' },
      { appVersion: '1.1.9' },
    ],
  ])('%s rule matches and rejects', (_name, rule, yes, no) => {
    expect(evaluateFlag(flag([rule]), /** @type {any} */ (yes))).toBe(true);
    expect(evaluateFlag(flag([rule]), /** @type {any} */ (no))).toBe(false);
    expect(evaluateFlag(flag([rule]), {})).toBe(false);
  });

  it('percentage rollout is stable per user and roughly proportional', () => {
    const rule = { type: 'percentage', percent: 25 };
    const users = Array.from({ length: 4000 }, (_, i) => `user-${i}`);
    const on = users.filter((userId) => evaluateFlag(flag([rule]), { userId })).length;
    expect(on / users.length).toBeGreaterThan(0.22);
    expect(on / users.length).toBeLessThan(0.28);
    expect(evaluateFlag(flag([rule]), { userId: 'user-7' })).toBe(
      evaluateFlag(flag([rule]), { userId: 'user-7' }),
    );
    expect(evaluateFlag(flag([rule]), {})).toBe(false);
    expect(rolloutBucket('a', 'u')).toBeGreaterThanOrEqual(0);
    expect(rolloutBucket('a', 'u')).toBeLessThan(100);
  });

  it('a kill switch turns the flag off for everyone', () => {
    expect(evaluateFlag(flag([{ type: 'killSwitch' }]), { userId: 'u' })).toBe(false);
  });

  it('requires every rule to match', () => {
    const both = flag([
      { type: 'platform', platforms: ['ios'] },
      { type: 'cohort', cohorts: ['beta'] },
    ]);
    expect(evaluateFlag(both, { platform: 'ios', cohorts: ['beta'] })).toBe(true);
    expect(evaluateFlag(both, { platform: 'ios' })).toBe(false);
  });
});

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
  });
});
