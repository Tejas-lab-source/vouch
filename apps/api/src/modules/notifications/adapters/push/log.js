// @ts-check
import { createHash } from 'node:crypto';

/**
 * Development push provider: logs the template and a token hash (never the token) and records
 * the message for tests through `sink`. Refused in production by the env schema.
 * @param {{ logger: import('pino').Logger, sink?: (message: import('../../ports.js').PushMessage) => void, invalidTokens?: Set<string> }} options
 * @returns {import('../../ports.js').PushProvider}
 */
export function createLogPush({ logger, sink, invalidTokens = new Set() }) {
  let n = 0;
  return {
    name: 'log',
    async send(messages) {
      return messages.map((m) => {
        sink?.(m);
        const tokenHash = createHash('sha256').update(m.token).digest('hex').slice(0, 12);
        logger.info({ tokenHash, type: m.data.type }, 'development push');
        if (invalidTokens.has(m.token)) {
          return { token: m.token, ticketId: null, error: 'DeviceNotRegistered' };
        }
        n += 1;
        return { token: m.token, ticketId: `dev-${n}`, error: null };
      });
    },
    async receipts(ticketIds) {
      return new Map(ticketIds.map((id) => [id, null]));
    },
  };
}
