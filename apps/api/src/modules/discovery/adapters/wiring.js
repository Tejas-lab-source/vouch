// @ts-check
import { PIPELINES } from '@vouch/contracts';
import { CANDIDATE_FILTERS, makeBuildDeck, SCORERS } from '../application/build-deck.js';
import { makeDiscoveryConsumers } from '../application/consumers.js';
import { excludeBlocked } from '../application/filters/exclude-blocked.js';
import { excludeInactive } from '../application/filters/exclude-inactive.js';
import { excludeSelf } from '../application/filters/exclude-self.js';
import { excludeSwiped } from '../application/filters/exclude-swiped.js';
import { mutualPreferences } from '../application/filters/mutual-preferences.js';
import { makeNextCards } from '../application/next-cards.js';
import { completeness } from '../application/scorers/completeness.js';
import { exposureCap } from '../application/scorers/exposure-cap.js';
import { newUser } from '../application/scorers/new-user.js';
import { recency } from '../application/scorers/recency.js';
import { createBuildQueue } from './jobs/builds.js';
import { createCandidateSource } from './pg/candidate-source.js';
import { createHandTunedRanker } from './ranker/hand-tuned.js';
import { createDeckStore } from './redis/deck-store.js';

const definedOn = new WeakSet();

/**
 * Exposure counts are global per candidate, so one shared, prefetched map serves every
 * concurrent build. It is cleared when the day changes.
 * @param {import('../ports.js').DeckStore} decks
 */
function createExposureCounts(decks) {
  let day = '';
  /** @type {Map<string, number>} */
  let counts = new Map();
  return {
    counts: () => counts,
    /** @param {readonly string[]} ids @param {string} today */
    prefetch: async (ids, today) => {
      if (today !== day) {
        day = today;
        counts = new Map();
      }
      for (const [id, n] of await decks.exposure(ids, today)) counts.set(id, n);
    },
  };
}

/**
 * Builds discovery's dependencies, defines the chains it owns and adds its v1 steps.
 * @param {any} ctx  Registry context; `ctx.deps` holds identity, profiles and safety.
 */
export function buildDiscoveryDeps(ctx) {
  const { config, db, redis, jobs, clock, logger, pipelines } = ctx;
  const source = createCandidateSource({ db });
  const decks = createDeckStore({ redis: redis.command });
  const exposure = createExposureCounts(decks);
  const settings = {
    weightBase: config.DISCOVERY_WEIGHT_BASE,
    weightRecency: config.DISCOVERY_WEIGHT_RECENCY,
    weightCompleteness: config.DISCOVERY_WEIGHT_COMPLETENESS,
    weightNewUser: config.DISCOVERY_WEIGHT_NEW_USER,
    recencyHalfLifeHours: config.DISCOVERY_RECENCY_HALF_LIFE_HOURS,
    newUserDays: config.DISCOVERY_NEW_USER_DAYS,
    exposureCap: config.DISCOVERY_EXPOSURE_CAP,
    maxNewUsersTop10: config.DISCOVERY_MAX_NEW_USERS_TOP10,
    maxPhotos: config.PHOTOS_MAX,
  };
  const safety = ctx.deps.safety;

  if (!definedOn.has(pipelines)) {
    const definitions = new Map(Object.entries(PIPELINES));
    for (const name of [CANDIDATE_FILTERS, SCORERS]) {
      const definition = definitions.get(name);
      if (!definition) throw new Error(`pipeline ${name} is not in the contracts`);
      pipelines.define(name, {
        failClosed: definition.failClosed,
        stepTimeoutMs: definition.stepTimeoutMs,
      });
    }
    for (const step of [
      excludeSelf(),
      excludeSwiped({ swipedAmong: source.swipedAmong }),
      excludeBlocked({ blockedAmong: safety.blockPolicy.blockedAmong }),
      excludeInactive({ bannedAmong: safety.bannedAmong }),
      mutualPreferences(),
    ]) {
      pipelines.contribute(CANDIDATE_FILTERS, step);
    }
    for (const step of [
      recency({ clock, halfLifeHours: settings.recencyHalfLifeHours }),
      completeness({ maxPhotos: settings.maxPhotos }),
      newUser({ clock, days: settings.newUserDays }),
      exposureCap({ cap: settings.exposureCap, counts: exposure.counts }),
    ]) {
      pipelines.contribute(SCORERS, step);
    }
    definedOn.add(pipelines);
  }

  /** @type {import('../ports.js').DiscoveryDeps & { exposure: typeof exposure }} */
  const deps = {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('discovery'),
    source,
    decks,
    ranker: createHandTunedRanker(settings),
    settings,
    pipelines,
    safety,
    profiles: ctx.deps.profiles,
    identity: ctx.deps.identity,
    builds: createBuildQueue({ jobs }),
    clock,
    logger: logger.child({ module: 'discovery' }),
    exposure,
  };
  return deps;
}

/** @param {ReturnType<typeof buildDiscoveryDeps>} deps */
export function buildDiscoveryHandlers(deps) {
  return {
    ...makeNextCards(deps),
    buildDeck: makeBuildDeck(deps),
    consumers: makeDiscoveryConsumers(deps),
  };
}
