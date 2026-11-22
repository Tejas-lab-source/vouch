// @ts-check

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 5_000;

/**
 * Staff alert email (new reports). Ids and the reason only: never names, messages or emails.
 * Resend over HTTP in production; the console in development.
 * @param {{ provider: string, apiKey?: string, from?: string, logger: import('pino').Logger, fetchImpl?: typeof fetch, sink?: (mail: { to: string, subject: string, text: string }) => void }} options
 * @returns {import('../../ports.js').AlertEmail}
 */
export function createAlertEmail({ provider, apiKey, from, logger, fetchImpl = fetch, sink }) {
  if (provider === 'resend') {
    return {
      async send({ to, subject, text }) {
        const response = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Resend returned ${response.status}`);
      },
    };
  }
  if (provider !== 'console')
    throw new Error(`EMAIL_PROVIDER ${provider} is not supported for alerts`);
  return {
    async send(mail) {
      sink?.(mail);
      logger.info({ subject: mail.subject }, 'development alert email');
    },
  };
}
