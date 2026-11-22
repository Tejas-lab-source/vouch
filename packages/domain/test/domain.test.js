// @ts-check
import { describe, expect, it } from 'vitest';
import {
  ageOn,
  compareVersions,
  formatCount,
  isAdult,
  isEmail,
  isIsoDate,
  isOtp,
  relativeTime,
} from '../src/index.js';

describe('domain rules', () => {
  const today = new Date('2026-11-22T10:00:00Z');

  it('age turns over on the birthday, not before', () => {
    expect(ageOn('2008-11-22', today)).toBe(18);
    expect(ageOn('2008-11-23', today)).toBe(17);
    expect(isAdult('2008-11-22', today)).toBe(true);
    expect(isAdult('2008-11-23', today)).toBe(false);
    expect(isAdult('not-a-date', today)).toBe(false);
  });

  it('validates dates, emails and codes', () => {
    expect(isIsoDate('2005-02-29')).toBe(false);
    expect(isIsoDate('2004-02-29')).toBe(true);
    expect(isEmail('a@northfield.example.edu')).toBe(true);
    expect(isEmail('nope')).toBe(false);
    expect(isOtp('123456')).toBe(true);
    expect(isOtp('12345a')).toBe(false);
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
  });

  it('formats relative times and counts', () => {
    expect(relativeTime(new Date('2026-11-22T09:59:30Z'), today)).toBe('now');
    expect(relativeTime(new Date('2026-11-22T09:55:00Z'), today)).toBe('5 min');
    expect(relativeTime(new Date('2026-11-22T07:00:00Z'), today)).toBe('3 h');
    expect(relativeTime(new Date('2026-11-20T10:00:00Z'), today)).toBe('2 d');
    expect(relativeTime(new Date('2026-10-01T10:00:00Z'), today)).toBe('2026-10-01');
    expect(formatCount(7)).toBe('7');
    expect(formatCount(250)).toBe('99+');
  });
});
