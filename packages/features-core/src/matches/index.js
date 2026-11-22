// @ts-check
import { getLikesCount, keys, listMatches, unmatch } from '@vouch/api-client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../react.jsx';

/** @typedef {Awaited<ReturnType<typeof listMatches>>['items'][number]} MatchSummary */

/** The caller's matches, newest first, as an infinite list (`fetchNextPage`). */
export function useMatches({ pageSize = 20 } = {}) {
  const { client } = useServices();
  const query = useInfiniteQuery({
    queryKey: keys.matches(),
    initialPageParam: /** @type {string | undefined} */ (undefined),
    queryFn: ({ pageParam }) =>
      listMatches(client, {
        query: { limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  /** @type {MatchSummary[]} */
  const matches = query.data?.pages.flatMap((page) => page.items) ?? [];
  return { ...query, matches };
}

/** Unmatch (after the screen's confirmation step). The match leaves the list at once. */
export function useUnmatch() {
  const { client } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    /** @param {string} matchId */
    mutationFn: (matchId) => unmatch(client, { params: { id: matchId }, body: {} }),
    onMutate: async (matchId) => {
      await queryClient.cancelQueries({ queryKey: keys.matches() });
      const previous = queryClient.getQueryData(keys.matches());
      queryClient.setQueryData(keys.matches(), (/** @type {any} */ data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((/** @type {any} */ page) => ({
                ...page,
                items: page.items.filter((/** @type {MatchSummary} */ m) => m.matchId !== matchId),
              })),
            }
          : data,
      );
      return { previous };
    },
    onError: (_error, _id, context) => queryClient.setQueryData(keys.matches(), context?.previous),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.matches() });
      void queryClient.invalidateQueries({ queryKey: keys.conversations() });
    },
  });
}

/** How many people liked you and wait for your swipe (a number only). */
export function useLikesCount() {
  const { client } = useServices();
  return useQuery({
    queryKey: keys.likesCount(),
    queryFn: async () => (await getLikesCount(client)).count,
    staleTime: 60_000,
  });
}
