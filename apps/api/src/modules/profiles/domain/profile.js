// @ts-check

/** A profile needs this many approved photos to become active. */
export const MIN_APPROVED_PHOTOS = 2;

/** Default age preference for a new profile (owner decision, roadmap Phase 6). */
export const DEFAULT_AGE_RANGE = Object.freeze({ min: 18, max: 30 });

/** @typedef {'pending' | 'active' | 'hidden'} ProfileStatus */
/** @typedef {'name' | 'gender' | 'interestedIn' | 'photos'} Requirement */

/**
 * What a profile still needs before it can be shown to others. Empty means complete.
 * @param {{ name: string | null, gender: number | null, interestedIn: readonly number[] }} profile
 * @param {number} approvedPhotos
 * @returns {Requirement[]}
 */
export function missingRequirements(profile, approvedPhotos) {
  /** @type {Requirement[]} */
  const missing = [];
  if (!profile.name) missing.push('name');
  if (profile.gender === null) missing.push('gender');
  if (profile.interestedIn.length === 0) missing.push('interestedIn');
  if (approvedPhotos < MIN_APPROVED_PHOTOS) missing.push('photos');
  return missing;
}

/**
 * Status after a change. `pending → active` when complete, `active → pending` when it stops
 * being complete (for example a photo was deleted). `hidden` is only left by an explicit
 * unhide (a later phase), so changes never move a profile out of it.
 * @param {ProfileStatus} current
 * @param {readonly Requirement[]} missing
 * @returns {ProfileStatus}
 */
export function nextStatus(current, missing) {
  if (current === 'hidden') return 'hidden';
  return missing.length === 0 ? 'active' : 'pending';
}

/**
 * Whole years between a birth date and `today` (calendar dates, UTC).
 * @param {string} birthDate  `YYYY-MM-DD`
 * @param {Date} today
 */
export function ageOn(birthDate, today) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const years = today.getUTCFullYear() - (y ?? 0);
  const beforeBirthday =
    today.getUTCMonth() + 1 < (m ?? 1) ||
    (today.getUTCMonth() + 1 === m && today.getUTCDate() < (d ?? 1));
  return beforeBirthday ? years - 1 : years;
}

/**
 * The age preference after an edit that may change only one end.
 * @param {{ minAge: number, maxAge: number }} current
 * @param {{ minAge?: number, maxAge?: number }} patch
 * @returns {{ minAge: number, maxAge: number } | null}  Null when min would exceed max.
 */
export function mergeAgeRange(current, patch) {
  const minAge = patch.minAge ?? current.minAge;
  const maxAge = patch.maxAge ?? current.maxAge;
  return minAge <= maxAge ? { minAge, maxAge } : null;
}

/**
 * The smallest photo position (0–5) not used by a pending or approved photo.
 * @param {readonly { position: number, status: string }[]} photos
 * @param {number} maxPhotos
 * @returns {number | null}  Null when every position is taken.
 */
export function nextPhotoPosition(photos, maxPhotos) {
  const taken = new Set(
    photos.filter((p) => p.status === 'pending' || p.status === 'approved').map((p) => p.position),
  );
  for (let position = 0; position < maxPhotos; position += 1) {
    if (!taken.has(position)) return position;
  }
  return null;
}
