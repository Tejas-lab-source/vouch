// @ts-check
import { ApiError, keys, swipe } from '@vouch/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { noAnalytics } from '../analytics/index.js';
import { removeCard, restoreCard } from '../deck/index.js';
import { useServices } from '../react.jsx';

/** Errors after which the card must not come back (it can no longer be swiped). */
const FINAL = new Set(['NOT_SERVED', 'BLOCKED', 'NOT_FOUND', 'PROFILE_INCOMPLETE']);

/** Network failures and 5xx are retried with the same `swipeId`. @param {unknown} error */
export const isRetryable = (error) =>
  error instanceof ApiError && (error.code === 'NETWORK' || error.status >= 500);

/**
 * Like or pass the top card. The card leaves the deck at once (optimistic); the request
 * carries a `swipeId` made once per swipe, so retries are idempotent; on failure the card is
 * put back where it was. `onMatch` runs when the like made a match.
 * @param {{ onMatch?: (match: { matchId: string, card: import('../deck/index.js').ProfileCard }) => void, retryDelayMs?: number }} [options]
 */
export function useSwipe({ onMatch, retryDelayMs = 500 } = {}) {
  const {
    client,
    analytics = noAnalytics,
    newId = () => /** @type {any} */ (globalThis).crypto.randomUUID(),
  } = useServices();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    /** @param {{ card: import('../deck/index.js').ProfileCard, direction: 'like' | 'pass', swipeId: string, index: number }} vars */
    mutationFn: ({ card, direction, swipeId }) =>
      swipe(client, { body: { swipeId, targetId: card.userId, direction } }),
    retry: (count, error) => count < 2 && isRetryable(error),
    retryDelay: retryDelayMs,
    onMutate: ({ card }) => {
      queryClient.setQueryData(keys.deck(), (/** @type {any} */ deck) =>
        removeCard(deck, card.userId),
      );
    },
    onError: (error, { card, index }) => {
      if (error instanceof ApiError && FINAL.has(error.code)) return;
      queryClient.setQueryData(keys.deck(), (/** @type {any} */ deck) =>
        restoreCard(deck, card, index),
      );
    },
    onSuccess: (result, { card, direction }) => {
      analytics.track('swipe', { direction });
      if (result.matched && result.matchId) {
        analytics.track('match', { source: 'swipe' });
        void queryClient.invalidateQueries({ queryKey: keys.matches() });
        onMatch?.({ matchId: result.matchId, card });
      }
    },
  });

  const send = useCallback(
    /**
     * @param {import('../deck/index.js').ProfileCard} card
     * @param {'like' | 'pass'} direction
     */
    (card, direction) => {
      const deck = /** @type {import('../deck/index.js').DeckState | undefined} */ (
        queryClient.getQueryData(keys.deck())
      );
      const index = Math.max(0, deck?.cards.findIndex((c) => c.userId === card.userId) ?? 0);
      // Failures are reported through `error` (and the card comes back), never thrown.
      return mutation.mutateAsync({ card, direction, swipeId: newId(), index }).catch(() => null);
    },
    [mutation, newId, queryClient],
  );

  return {
    like: (/** @type {import('../deck/index.js').ProfileCard} */ card) => send(card, 'like'),
    pass: (/** @type {import('../deck/index.js').ProfileCard} */ card) => send(card, 'pass'),
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
