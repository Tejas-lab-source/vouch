// @ts-check
import { describe, expect, it } from 'vitest';
import {
  ageOn,
  DEFAULT_AGE_RANGE,
  mergeAgeRange,
  missingRequirements,
  nextPhotoPosition,
  nextStatus,
} from '../../../src/modules/profiles/domain/profile.js';

const COMPLETE = { name: 'Aditi', gender: 0, interestedIn: [1] };

describe('profile completeness', () => {
  it('needs a name, a gender, interests and at least 2 approved photos', () => {
    expect(missingRequirements(COMPLETE, 2)).toEqual([]);
    expect(missingRequirements(COMPLETE, 1)).toEqual(['photos']);
    expect(missingRequirements({ name: null, gender: null, interestedIn: [] }, 0)).toEqual([
      'name',
      'gender',
      'interestedIn',
      'photos',
    ]);
    // Gender code 0 (woman) is a value, not a missing one.
    expect(missingRequirements({ ...COMPLETE, gender: 0 }, 6)).toEqual([]);
  });

  it('defaults the age preference to 18–30', () => {
    expect(DEFAULT_AGE_RANGE).toEqual({ min: 18, max: 30 });
  });
});

describe('status transitions', () => {
  it('pending → active when complete, active → pending when no longer complete', () => {
    expect(nextStatus('pending', [])).toBe('active');
    expect(nextStatus('pending', ['photos'])).toBe('pending');
    expect(nextStatus('active', ['photos'])).toBe('pending');
    expect(nextStatus('active', [])).toBe('active');
  });

  it('a hidden profile stays hidden whatever changes', () => {
    expect(nextStatus('hidden', [])).toBe('hidden');
    expect(nextStatus('hidden', ['name'])).toBe('hidden');
  });
});

describe('edits', () => {
  it('merges a one-sided age range edit and refuses min above max', () => {
    expect(mergeAgeRange({ minAge: 18, maxAge: 30 }, { maxAge: 25 })).toEqual({
      minAge: 18,
      maxAge: 25,
    });
    expect(mergeAgeRange({ minAge: 18, maxAge: 30 }, { minAge: 31 })).toBeNull();
    expect(mergeAgeRange({ minAge: 20, maxAge: 30 }, { minAge: 20, maxAge: 20 })).toEqual({
      minAge: 20,
      maxAge: 20,
    });
  });

  it('assigns the smallest free photo position; rejected and deleted photos free theirs', () => {
    expect(nextPhotoPosition([], 6)).toBe(0);
    expect(
      nextPhotoPosition(
        [
          { position: 0, status: 'approved' },
          { position: 1, status: 'rejected' },
          { position: 2, status: 'pending' },
          { position: 3, status: 'deleted' },
        ],
        6,
      ),
    ).toBe(1);
    const full = [0, 1, 2, 3, 4, 5].map((position) => ({ position, status: 'approved' }));
    expect(nextPhotoPosition(full, 6)).toBeNull();
  });

  it('computes age in whole years on calendar dates', () => {
    expect(ageOn('2005-11-22', new Date('2026-11-22T00:00:00Z'))).toBe(21);
    expect(ageOn('2005-11-23', new Date('2026-11-22T23:59:59Z'))).toBe(20);
  });
});
