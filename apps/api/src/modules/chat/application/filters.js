// @ts-check
import { countLinks, linkRule, MESSAGE_KINDS } from '../domain/messages.js';

export const MESSAGE_FILTERS = 'chat.messageFilters';

/**
 * The v1 steps of `chat.messageFilters` (fail closed): length, link limiter, block check. Each
 * judges the same input; the first refusal wins.
 * @param {{
 *   countBySender: (conversationId: string, senderId: string) => Promise<number>,
 *   isBlocked: (a: string, b: string) => Promise<boolean>,
 *   limits: { maxPerMessage: number, freeAfter: number },
 * }} deps
 * @returns {import('../../../platform/pipelines.js').PipelineStep[]}
 */
export function messageFilterSteps({ countBySender, isBlocked, limits }) {
  /** @typedef {{ conversationId: string, senderId: string, recipientId: string, kind: string, body: string }} Input */
  const allow = (/** @type {Input} */ input) => ({ allow: true, body: input.body });
  const refuse = (/** @type {string} */ reason) => ({
    allow: false,
    code: 'MESSAGE_REJECTED',
    reason,
  });
  return [
    {
      id: 'chat.length',
      order: 10,
      run: (/** @type {Input} */ input) =>
        MESSAGE_KINDS.get(input.kind)?.validate(input.body)
          ? allow(input)
          : refuse('Messages must be between 1 and 1,000 characters.'),
    },
    {
      id: 'chat.linkLimiter',
      order: 20,
      run: async (/** @type {Input} */ input) => {
        const links = countLinks(input.body);
        if (links === 0) return allow(input);
        const prior = await countBySender(input.conversationId, input.senderId);
        const reason = linkRule({ links, senderPriorMessages: prior }, limits);
        return reason ? refuse(reason) : allow(input);
      },
    },
    {
      id: 'chat.blockCheck',
      order: 30,
      // A block is reported as a closed conversation, never as a block.
      run: async (/** @type {Input} */ input) =>
        (await isBlocked(input.senderId, input.recipientId))
          ? { allow: false, code: 'CONVERSATION_CLOSED' }
          : allow(input),
    },
  ];
}
