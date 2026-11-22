// @ts-check
import { getMyProfile, keys, updateMyProfile } from '@vouch/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../react.jsx';

/**
 * The client-side shapes of the profile contracts (`OwnProfile`, `OwnPhoto` in
 * `packages/contracts/src/common/entities.js`), spelled out so screens are type-checked.
 * @typedef {{ w400: string, w1080: string }} PhotoUrls
 * @typedef {{ id: string, position: number, status: 'pending' | 'approved' | 'rejected', urls: PhotoUrls | null }} OwnPhoto
 * @typedef {{
 *   userId: string,
 *   status: 'pending' | 'active' | 'hidden',
 *   name: string | null,
 *   gender: 0 | 1 | 2 | null,
 *   interestedIn: Array<0 | 1 | 2>,
 *   bio: string | null,
 *   age: number,
 *   minAge: number,
 *   maxAge: number,
 *   photos: OwnPhoto[],
 *   sections: unknown[],
 *   missing: Array<'name' | 'gender' | 'interestedIn' | 'photos'>,
 * }} OwnProfile
 */

/** The signed-in user's own profile (`keys.me()`). */
export function useMyProfile() {
  const { client } = useServices();
  return useQuery({
    queryKey: keys.me(),
    queryFn: async () => /** @type {OwnProfile} */ (await getMyProfile(client)),
  });
}

/**
 * Edits profile fields. The response is the new profile, written straight into the cache.
 */
export function useUpdateProfile() {
  const { client } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    /** @param {NonNullable<Parameters<typeof updateMyProfile>[1]>['body']} body */
    mutationFn: (body) => updateMyProfile(client, { body }),
    onSuccess: (profile) => {
      queryClient.setQueryData(keys.me(), profile);
      // The deck depends on preferences (genders, ages).
      void queryClient.invalidateQueries({ queryKey: keys.deck() });
    },
  });
}
