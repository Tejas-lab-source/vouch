// @ts-check

/**
 * Development email provider: logs the code with an email-HMAC prefix (never the address).
 * Refused in production by the env schema.
 * @param {{ logger: import('pino').Logger, sink?: (message: { to: string, code: string }) => void }} options
 * @returns {import('../../ports.js').EmailProvider}
 */
export function createConsoleEmailProvider({ logger, sink }) {
  return {
    async sendOtp({ to, code, emailHmac }) {
      sink?.({ to, code });
      logger.info(
        { emailHmacPrefix: emailHmac.toString('hex').slice(0, 8), devOtp: code },
        'development email: sign-in code',
      );
    },
  };
}
