// @ts-check
import { ageOn, missingRequirements } from '../domain/profile.js';

/**
 * @param {import('../ports.js').PhotoRecord} photo
 * @param {(key: string) => string} url
 */
const urlsOf = (photo, url) =>
  photo.status === 'approved' && photo.key1080 && photo.key400
    ? { w400: url(photo.key400), w1080: url(photo.key1080) }
    : null;

/** @param {import('../ports.js').SectionRecord} s */
const sectionView = (s) => ({
  type: s.type,
  schemaVersion: s.schemaVersion,
  position: s.position,
  data: s.data,
});

/**
 * The owner's view of their profile (`OwnProfile`). Deleted photos are left out; rejected ones
 * stay, with `urls: null`, so the owner sees what happened.
 * @param {{
 *   profile: import('../ports.js').ProfileRecord,
 *   publicId: string,
 *   photos: readonly import('../ports.js').PhotoRecord[],
 *   sections: readonly import('../ports.js').SectionRecord[],
 *   url: (key: string) => string,
 *   now: Date,
 * }} input
 */
export function ownProfileView({ profile, publicId, photos, sections, url, now }) {
  const visible = photos.filter((p) => p.status !== 'deleted');
  const approved = visible.filter((p) => p.status === 'approved').length;
  return {
    userId: publicId,
    status: profile.status,
    name: profile.name,
    gender: profile.gender,
    interestedIn: profile.interestedIn,
    bio: profile.bio,
    age: ageOn(profile.birthDate, now),
    minAge: profile.minAge,
    maxAge: profile.maxAge,
    photos: visible.map((p) => ({
      id: p.id,
      position: p.position,
      status: /** @type {'pending' | 'approved' | 'rejected'} */ (p.status),
      urls: urlsOf(p, url),
    })),
    sections: sections.map(sectionView),
    missing: missingRequirements(profile, approved),
  };
}

/**
 * The card other users see (`ProfileCard`): approved photos only, age instead of birth date.
 * Null when the profile cannot be shown (no name, gender or approved photo).
 * @param {{
 *   profile: import('../ports.js').ProfileRecord,
 *   publicId: string,
 *   collegeName: string,
 *   photos: readonly import('../ports.js').PhotoRecord[],
 *   sections: readonly import('../ports.js').SectionRecord[],
 *   url: (key: string) => string,
 *   now: Date,
 * }} input
 */
export function cardView({ profile, publicId, collegeName, photos, sections, url, now }) {
  const urls = photos.map((p) => urlsOf(p, url)).filter((u) => u !== null);
  if (!profile.name || profile.gender === null || urls.length === 0) return null;
  return {
    userId: publicId,
    name: profile.name,
    age: ageOn(profile.birthDate, now),
    gender: profile.gender,
    collegeName,
    bio: profile.bio,
    photos: urls.slice(0, 6),
    sections: sections.map(sectionView),
  };
}
