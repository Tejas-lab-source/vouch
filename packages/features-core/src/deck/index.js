// @ts-check
import { getDeck, keys } from '@vouch/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { noAnalytics } from '../analytics/index.js';
import { useServices } from '../react.jsx';

/** Fetch the next page when this many cards (or fewer) remain (roadmap Phase 12). */
export const PREFETCH_AT = 3;
/** How many swiped ids to remember, so a page fetched mid-swipe cannot bring a card back. */
const REMEMBER = 200;

/**
 * @typedef {Awaited<ReturnType<typeof getDeck>>['cards'][number]} ProfileCard
 * @typedef {{ cards: ProfileCard[], removed: string[], exhausted: boolean }} DeckState
 *   `exhausted`: the last fetch brought nothing new; cleared by the next swipe or refetch.
 */

/**
 * Appends a fetched page to the deck, dropping cards already queued or already swiped.
 * @param {DeckState | undefined} deck @param {readonly ProfileCard[]} page
 * @returns {DeckState}
 */
export function mergePage(deck, page) {
  const current = deck ?? { cards: [], removed: [], exhausted: false };
  const known = new Set([...current.cards.map((c) => c.userId), ...current.removed]);
  const fresh = page.filter((card) => !known.has(card.userId));
  return { ...current, cards: [...current.cards, ...fresh], exhausted: fresh.length === 0 };
}

/**
 * Takes a card out of the deck (a swipe or a block), remembering it so it is not re-added.
 * @param {DeckState | undefined} deck @param {string} userId
 * @returns {DeckState | undefined}
 */
export function removeCard(deck, userId) {
  if (!deck) return deck;
  return {
    cards: deck.cards.filter((c) => c.userId !== userId),
    removed: [...deck.removed.filter((id) => id !== userId), userId].slice(-REMEMBER),
    exhausted: false,
  };
}

/**
 * Puts a card back at its old index (a failed swipe).
 * @param {DeckState | undefined} deck @param {ProfileCard} card @param {number} index
 * @returns {DeckState | undefined}
 */
export function restoreCard(deck, card, index) {
  if (!deck || deck.cards.some((c) => c.userId === card.userId)) return deck;
  const cards = [...deck.cards];
  cards.splice(Math.min(index, cards.length), 0, card);
  return { ...deck, cards, removed: deck.removed.filter((id) => id !== card.userId) };
}

/**
 * The deck: the queued cards, the next page fetched when `PREFETCH_AT` remain, and
 * `exhausted` when the server has nothing new ("You're all caught up").
 */
export function useDeck() {
  const { client, analytics = noAnalytics } = useServices();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keys.deck(),
    queryFn: async () => mergePage(undefined, (await getDeck(client)).cards),
    staleTime: Infinity,
  });
  const fetching = useRef(false);
  const viewed = useRef(false);
  const deck = query.data;

  useEffect(() => {
    if (deck && !viewed.current) {
      viewed.current = true;
      analytics.track('deck_viewed', { cards: deck.cards.length });
    }
  }, [deck, analytics]);

  useEffect(() => {
    if (!deck || deck.exhausted || deck.cards.length > PREFETCH_AT || fetching.current) return;
    fetching.current = true;
    getDeck(client)
      .then(({ cards }) =>
        queryClient.setQueryData(keys.deck(), (/** @type {DeckState | undefined} */ d) =>
          mergePage(d, cards),
        ),
      )
      .catch(() => {})
      .finally(() => {
        fetching.current = false;
      });
  }, [deck, client, queryClient]);

  return {
    cards: deck?.cards ?? [],
    current: deck?.cards.at(0) ?? null,
    exhausted: Boolean(deck && deck.cards.length === 0 && deck.exhausted),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
