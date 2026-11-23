// @ts-check
import { useCallback, useEffect, useMemo, useState } from 'react';
import { noAnalytics } from '../analytics/index.js';
import { useMyProfile } from '../profile/index.js';
import { useServices } from '../react.jsx';

/**
 * Onboarding after sign-in (birth date and consent are taken at sign-up, before any data is
 * stored). The order of the screens.
 */
export const ONBOARDING_STEPS = Object.freeze(['basics', 'interestedIn', 'ageRange', 'photos']);
/** At least this many photos (not rejected) before onboarding can finish. */
export const MIN_PHOTOS = 2;

/**
 * @typedef {(typeof ONBOARDING_STEPS)[number] | 'done'} OnboardingStep
 * @typedef {object} Prefs  Small, non-personal key-value storage that survives restarts.
 * @property {(key: string) => Promise<string | null>} get
 * @property {(key: string, value: string) => Promise<void>} set
 */

/** @returns {Prefs} */
export function memoryPrefs() {
  /** @type {Map<string, string>} */
  const values = new Map();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
  };
}

/**
 * The first step not done yet. Most of the answer comes from the server profile; only the
 * steps that have server defaults (the age range) or need a decision (photos are enough) are
 * marked as confirmed on the device.
 * @param {Pick<import('../profile/index.js').OwnProfile, 'name' | 'gender' | 'interestedIn' | 'photos' | 'missing'>} profile
 * @param {ReadonlySet<string>} confirmed
 * @returns {OnboardingStep}
 */
export function nextOnboardingStep(profile, confirmed) {
  if (!profile.name || profile.gender === null) return 'basics';
  if (profile.interestedIn.length === 0) return 'interestedIn';
  if (!confirmed.has('ageRange')) return 'ageRange';
  const usable = profile.photos.filter(
    (/** @type {{ status: string }} */ p) => p.status !== 'rejected',
  ).length;
  const photosDone = !profile.missing.includes('photos') || usable >= MIN_PHOTOS;
  if (!photosDone || !confirmed.has('photos')) return 'photos';
  return 'done';
}

/** @param {string} userId */
const prefKey = (userId) => `vouch.onboarding.${userId}`;

/**
 * The onboarding position, restored after a restart. `complete(step)` records a step as done.
 */
export function useOnboarding() {
  const { prefs: given, analytics = noAnalytics } = useServices();
  const prefs = useMemo(() => given ?? memoryPrefs(), [given]);
  const profile = useMyProfile();
  const userId = profile.data?.userId ?? null;
  /** @type {[Set<string> | null, (next: Set<string>) => void]} */
  const [confirmed, setConfirmed] = useState(/** @type {Set<string> | null} */ (null));

  useEffect(() => {
    if (!userId) return;
    let live = true;
    prefs
      .get(prefKey(userId))
      .catch(() => null)
      .then((raw) => {
        if (!live) return;
        /** @type {unknown} */
        let list = [];
        try {
          list = raw ? JSON.parse(raw) : [];
        } catch {
          list = [];
        }
        setConfirmed(new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []));
      });
    return () => {
      live = false;
    };
  }, [prefs, userId]);

  const step = profile.data && confirmed ? nextOnboardingStep(profile.data, confirmed) : null;

  const complete = useCallback(
    /** @param {(typeof ONBOARDING_STEPS)[number]} done */
    async (done) => {
      if (!userId || !confirmed) return;
      const next = new Set([...confirmed, done]);
      setConfirmed(next);
      analytics.track('onboarding_step_completed', { step: done });
      if (done === 'photos') analytics.track('onboarding_completed');
      await prefs.set(prefKey(userId), JSON.stringify([...next])).catch(() => {});
    },
    [userId, confirmed, prefs, analytics],
  );

  return {
    step,
    isLoading: profile.isLoading || (Boolean(profile.data) && !confirmed),
    isError: profile.isError,
    profile: profile.data ?? null,
    complete,
  };
}
