// @ts-check
import { isMember, messageView } from './views.js';

const EVIDENCE_MESSAGES = 20;

/**
 * Chat's step in `safety.reportEvidence` (Phase 10): the last 20 messages of a chat report's
 * conversation, as both members saw them. Refuses unless the reporter and the target are that
 * conversation's two members, so a report cannot read someone else's chat. This is the only
 * path by which staff can read messages (ARCHITECTURE.md 11).
 * @param {Pick<import('../ports.js').ChatDeps, 'read'> & { publicIdsOf: (ids: readonly string[]) => Promise<Map<string, string>> }} deps
 */
export function reportEvidenceStep({ read, publicIdsOf }) {
  return {
    id: 'chat.reportEvidence',
    order: 10,
    /** @param {{ reporterId: string, targetId: string, context: 'profile' | 'chat', conversationId: string | null }} input */
    run: async (input) => {
      if (input.context !== 'chat') return { messages: [], refuse: null };
      const refuse = { messages: [], refuse: /** @type {const} */ ('NOT_A_MEMBER') };
      if (!input.conversationId) return refuse;
      const conversationId = input.conversationId;
      const conversation = await read((stores) => stores.conversations.find(conversationId));
      if (
        !conversation ||
        input.reporterId === input.targetId ||
        !isMember(conversation, input.reporterId) ||
        !isMember(conversation, input.targetId)
      ) {
        return refuse;
      }
      const from = Math.max(0, conversation.lastSeq - EVIDENCE_MESSAGES);
      const rows = await read((stores) =>
        stores.messages.after(conversationId, from, EVIDENCE_MESSAGES),
      );
      const ids = await publicIdsOf([conversation.userLow, conversation.userHigh]);
      return { messages: rows.map((m) => messageView(m, ids)), refuse: null };
    },
  };
}
