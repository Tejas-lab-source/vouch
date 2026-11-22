// @ts-check
import { getMyProfile, keys, updateMyProfile } from '@vouch/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../react.jsx';

/**
 * @typedef {Awaited<ReturnType<typeof getMyProfile>>} OwnProfile
 * @typedef {OwnProfile['photos'][number]} OwnPhoto
 */

/** The signed-in user's own profile (`keys.me()`). */
export function useMyProfile() {
  const { client } = useServices();
  return useQuery({ queryKey: keys.me(), queryFn: () => getMyProfile(client) });
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
