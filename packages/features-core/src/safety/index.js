// @ts-check
import { blockUser, keys, reportUser } from '@vouch/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { removeCard } from '../deck/index.js';
import { useServices } from '../react.jsx';

/** Report a user (Phase 10 API). Reporting does not block; screens offer both. */
export function useReport() {
  const { client } = useServices();
  return useMutation({
    /** @param {NonNullable<Parameters<typeof reportUser>[1]>['body']} body */
    mutationFn: (body) => reportUser(client, { body }),
  });
}

/**
 * Block a user: they leave the deck and the match list at once, and both lists are refetched.
 */
export function useBlock() {
  const { client } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    /** @param {string} targetId  The other user's public id. */
    mutationFn: (targetId) => blockUser(client, { body: { targetId } }),
    onSuccess: (_result, targetId) => {
      queryClient.setQueryData(keys.deck(), (/** @type {any} */ deck) =>
        removeCard(deck, targetId),
      );
      void queryClient.invalidateQueries({ queryKey: keys.matches() });
      void queryClient.invalidateQueries({ queryKey: keys.conversations() });
    },
  });
}
