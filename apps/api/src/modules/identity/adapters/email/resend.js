// @ts-check

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 5_000;

/**
 * Sends sign-in codes through Resend's HTTP API (no SDK).
 * @param {{ apiKey: string, from: string, fetchImpl?: typeof fetch }} options
 * @returns {import('../../ports.js').EmailProvider}
 */
export function createResendEmailProvider({ apiKey, from, fetchImpl = fetch }) {
  return {
    async sendOtp({ to, code }) {
      const response = await fetchImpl(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `${code} is your Vouch code`,
          text: `Your Vouch sign-in code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email.`,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Resend returned ${response.status}`);
    },
  };
}
