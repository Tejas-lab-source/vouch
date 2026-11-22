// @ts-check

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;

/**
 * Cloudflare Turnstile verification. A network failure counts as "not verified".
 * @param {{ secret: string, fetchImpl?: typeof fetch }} options
 * @returns {import('../../ports.js').CaptchaVerifier}
 */
export function createTurnstileVerifier({ secret, fetchImpl = fetch }) {
  return {
    async verify(token, ip) {
      try {
        const response = await fetchImpl(VERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return false;
        const result = /** @type {{ success?: boolean }} */ (await response.json());
        return result.success === true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Development verifier: accepts every token. Refused in production by the env schema.
 * @returns {import('../../ports.js').CaptchaVerifier}
 */
export function createDevCaptchaVerifier() {
  return { verify: async () => true };
}
