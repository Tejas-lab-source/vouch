// @ts-check
import { PIPELINES } from '@vouch/contracts';
import { makeCardQueries, CARD_FIELDS_PIPELINE } from '../application/cards.js';
import { makeProfileConsumers } from '../application/events.js';
import { makeProfileModeration } from '../application/moderation.js';
import { makeProfileUseCases } from '../application/profile.js';
import { createProfilesStores } from './pg/stores.js';
import { createCardCache } from './redis/card-cache.js';

/** Pipelines are per platform; the owner defines each chain once. */
const definedOn = new WeakSet();

/**
 * Builds the profiles module's dependencies from the registry context. `ctx.deps` holds the
 * public APIs of identity and media (manifest `dependsOn`).
 * @param {any} ctx
 * @returns {import('../ports.js').ProfilesDeps}
 */
export function buildProfilesDeps(ctx) {
  const { config, db, redis, clock, logger, pipelines } = ctx;
  if (!definedOn.has(pipelines)) {
    const definition = new Map(Object.entries(PIPELINES)).get(CARD_FIELDS_PIPELINE);
    if (!definition) throw new Error(`pipeline ${CARD_FIELDS_PIPELINE} is not in the contracts`);
    pipelines.define(CARD_FIELDS_PIPELINE, {
      failClosed: definition.failClosed,
      stepTimeoutMs: definition.stepTimeoutMs,
    });
    definedOn.add(pipelines);
  }
  return {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('profiles', createProfilesStores),
    read: (fn) => db.read('profiles', (/** @type {any} */ tx) => fn(createProfilesStores(tx))),
    cards: createCardCache({ redis: redis.command, logger: logger.child({ module: 'profiles' }) }),
    identity: ctx.deps.identity,
    media: ctx.deps.media,
    sections: ctx.sections,
    pipelines,
    clock,
    photosMax: config.PHOTOS_MAX,
  };
}

/** @param {import('../ports.js').ProfilesDeps} deps */
export function buildProfilesHandlers(deps) {
  const useCases = makeProfileUseCases(deps);
  return {
    useCases,
    queries: { ...makeCardQueries(deps), ...makeProfileModeration(deps) },
    consumers: makeProfileConsumers({ ...deps, createEmptyProfile: useCases.createEmptyProfile }),
  };
}
