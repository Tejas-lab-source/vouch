// @ts-check
import { lockPair } from '../../../platform/locks.js';
import { makeMatchingConsumers } from '../application/consumers.js';
import { makeMatchingExport } from '../application/export.js';
import { makeMatches } from '../application/matches.js';
import { makePassBatching } from '../application/passes.js';
import { makeRetention } from '../application/retention.js';
import { makeSwipe } from '../application/swipe.js';
import { createMatchingQueue } from './jobs/queue.js';
import { createMatchingStores } from './pg/stores.js';
import { createPassBuffer } from './redis/pass-buffer.js';

/**
 * Builds matching's dependencies. `ctx.deps` holds identity, profiles, safety and discovery.
 * @param {any} ctx  Registry context; optional `overrides.matching.observeLockHold`.
 * @returns {import('../ports.js').MatchingDeps}
 */
export function buildMatchingDeps(ctx) {
  const { db, redis, jobs, clock, logger } = ctx;
  const log = logger.child({ module: 'matching' });
  return {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('matching', createMatchingStores),
    read: (fn) => db.read('matching', (/** @type {any} */ tx) => fn(createMatchingStores(tx))),
    passes: createPassBuffer({ redis: redis.command }),
    queue: createMatchingQueue({ jobs }),
    lockPair,
    identity: ctx.deps.identity,
    profiles: ctx.deps.profiles,
    discovery: ctx.deps.discovery,
    safety: ctx.deps.safety,
    clock,
    newId: ctx.newId,
    observeLockHold:
      ctx.overrides?.matching?.observeLockHold ??
      ((ms) => log.debug({ lockHoldMs: Number(ms.toFixed(2)) }, 'pair lock released')),
  };
}

/** @param {import('../ports.js').MatchingDeps} deps @param {any} ctx */
export function buildMatchingHandlers(deps, ctx) {
  return {
    ...makeSwipe(deps),
    ...makeMatches(deps),
    batching: makePassBatching(deps),
    retention: makeRetention({ ...deps, addJob: (name, payload) => ctx.jobs.add(name, payload) }),
    consumers: makeMatchingConsumers(deps),
    exportFor: makeMatchingExport(deps),
  };
}
