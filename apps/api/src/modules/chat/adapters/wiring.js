// @ts-check
import { PIPELINES } from '@vouch/contracts';
import { makeChatConsumers } from '../application/consumers.js';
import { makeConversations } from '../application/conversations.js';
import { makeChatExport } from '../application/export.js';
import { MESSAGE_FILTERS, messageFilterSteps } from '../application/filters.js';
import { makeChatRetention } from '../application/retention.js';
import { makeSend } from '../application/send.js';
import { makeSync } from '../application/sync.js';
import { createChatStores } from './pg/stores.js';
import { createPresence } from './redis/presence.js';

/** Filter steps that query get more than the 50 ms default (they still fail closed). */
const QUERY_STEP_TIMEOUT_MS = 500;
const definedOn = new WeakSet();

/**
 * Builds chat's dependencies, defines `chat.messageFilters` and adds its v1 steps.
 * @param {any} ctx  `ctx.deps` holds identity, profiles, safety and matching.
 * @returns {import('../ports.js').ChatDeps}
 */
export function buildChatDeps(ctx) {
  const { config, db, redis, clock, logger, pipelines } = ctx;
  /** @type {import('../ports.js').ChatDeps} */
  const deps = {
    useCase: ctx.useCase,
    uow: ctx.unitOfWork('chat', createChatStores),
    read: (fn) => db.read('chat', (/** @type {any} */ tx) => fn(createChatStores(tx))),
    presence: createPresence({ redis: redis.command }),
    sockets: ctx.sockets,
    rateLimiter: ctx.rateLimiter,
    pipelines,
    identity: ctx.deps.identity,
    profiles: ctx.deps.profiles,
    safety: ctx.deps.safety,
    matching: ctx.deps.matching,
    settings: {
      messagesPerMinute: config.RATE_LIMIT_MESSAGES_MINUTE,
      maxLinksPerMessage: config.CHAT_MAX_LINKS_PER_MESSAGE,
      linksAfterMessages: config.CHAT_LINKS_AFTER_MESSAGES,
    },
    clock,
    logger: logger.child({ module: 'chat' }),
  };
  if (!definedOn.has(pipelines)) {
    const definition = new Map(Object.entries(PIPELINES)).get(MESSAGE_FILTERS);
    if (!definition) throw new Error(`pipeline ${MESSAGE_FILTERS} is not in the contracts`);
    pipelines.define(MESSAGE_FILTERS, {
      failClosed: definition.failClosed,
      stepTimeoutMs: definition.stepTimeoutMs,
    });
    const steps = messageFilterSteps({
      countBySender: (conversationId, senderId) =>
        deps.read((stores) =>
          stores.messages.countBySender(conversationId, senderId, deps.settings.linksAfterMessages),
        ),
      isBlocked: deps.safety.blockPolicy.isBlocked,
      limits: {
        maxPerMessage: deps.settings.maxLinksPerMessage,
        freeAfter: deps.settings.linksAfterMessages,
      },
    });
    for (const step of steps) {
      pipelines.contribute(MESSAGE_FILTERS, {
        ...step,
        ...(step.id === 'chat.length' ? {} : { timeoutMs: QUERY_STEP_TIMEOUT_MS }),
      });
    }
    definedOn.add(pipelines);
  }
  return deps;
}

/** @param {import('../ports.js').ChatDeps} deps */
export function buildChatHandlers(deps) {
  const conversations = makeConversations(deps);
  const helpers = { ...deps, ...conversations };
  return {
    ...conversations,
    ...makeSend(helpers),
    ...makeSync(helpers),
    consumers: makeChatConsumers(helpers),
    purgeClosed: makeChatRetention(deps),
    exportFor: makeChatExport(deps),
    presence: deps.presence,
  };
}
