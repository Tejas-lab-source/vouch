// @ts-check
import { deckServed, ServiceError } from '@vouch/contracts';
import { DECK } from '../domain/deck.js';
import { dayKey } from '../domain/scores.js';

/**
 * The read path (`GET /v1/deck`, `api.nextCards`). Never builds a deck: it pops precomputed ids,
 * drops anyone blocked, banned or no longer showable, hydrates cards, and queues a refill.
 * @param {import('../ports.js').DiscoveryDeps} deps
 */
export function makeNextCards(deps) {
  const { useCase, uow, source, decks, safety, profiles, identity, builds, clock } = deps;

  /**
   * Pops up to `count` ids and keeps those that can be shown, as cards.
   * @param {string} viewerId
   * @param {number} count
   */
  async function take(viewerId, count) {
    const ids = await decks.pop(viewerId, count);
    if (ids === null) return null;
    if (ids.length === 0) return { cards: [], shown: [] };
    const [blocked, banned] = await Promise.all([
      safety.blockPolicy.blockedAmong(viewerId, ids),
      safety.bannedAmong(ids),
    ]);
    const allowed = ids.filter((id) => !blocked.has(id) && !banned.has(id));
    const cards = await profiles.getCards(allowed);
    const internal = await identity.getUsersByPublicIds(cards.map((card) => card.userId));
    const byPublicId = new Map(internal.map((u) => [u.publicId, u.id]));
    return {
      cards,
      shown: cards.map((card) => /** @type {string} */ (byPublicId.get(card.userId))),
    };
  }

  /**
   * @param {string} viewerId
   * @returns {Promise<{ cards: any[] }>}
   */
  async function nextCards(viewerId) {
    const now = clock.now();
    const viewer = await source.viewer(viewerId, now);
    if (!viewer) throw new ServiceError('PROFILE_INCOMPLETE');

    const first = await take(viewerId, DECK.page);
    if (first === null) {
      // No deck yet (or it expired): build one in the background, never on this request.
      await builds.enqueueBuild(viewerId, 'initial');
      return { cards: [] };
    }
    let { cards, shown } = first;
    if (cards.length < DECK.page) {
      // Some ids were dropped at read time: one more pop to fill the page.
      const more = await take(viewerId, DECK.page - cards.length);
      if (more) {
        cards = [...cards, ...more.cards];
        shown = [...shown, ...more.shown];
      }
    }

    if (shown.length > 0) {
      await decks.markServed(viewerId, shown);
      await decks.countExposure(shown, dayKey(now));
      await uow.run(({ emit }) =>
        emit(deckServed, { viewerId, targetIds: shown, servedAt: now.toISOString() }),
      );
    }
    if ((await decks.remaining(viewerId)) < DECK.refillBelow) {
      await builds.enqueueBuild(viewerId, 'refill');
    }
    return { cards };
  }

  const getDeck = useCase('discovery.getDeck', async (_input, ctx) =>
    nextCards(/** @type {string} */ (ctx.actor?.userId)),
  );

  return { nextCards, getDeck, wasServed: decks.wasServed };
}
