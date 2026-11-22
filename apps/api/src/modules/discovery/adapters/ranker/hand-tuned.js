// @ts-check
import { DECK } from '../../domain/deck.js';
import { rank } from '../../domain/ranking.js';

/**
 * `HandTunedRanker`: combines scorer outputs with weights from config (ADR 0014), gates out
 * capped candidates, and diversifies the first 10 slots. A learned ranker can replace it
 * behind the same `Ranker` port.
 * @param {import('../../ports.js').RankingSettings} settings
 * @returns {import('../../ports.js').Ranker}
 */
export function createHandTunedRanker(settings) {
  const config = {
    base: settings.weightBase,
    weights: new Map([
      ['discovery.recency', settings.weightRecency],
      ['discovery.completeness', settings.weightCompleteness],
      ['discovery.newUser', settings.weightNewUser],
    ]),
    gates: ['discovery.exposureCap'],
    newUserScorer: 'discovery.newUser',
    maxNewUsersTop: settings.maxNewUsersTop10,
    diversifySlots: DECK.diversifySlots,
    size: DECK.size,
  };
  return { rank: (scored) => rank(scored, config) };
}
