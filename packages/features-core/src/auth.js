// @ts-check
import { ApiError, requestOtp, verifyOtp } from '@vouch/api-client';

/**
 * The sign-in flow as a small state machine, shared by web and mobile (Phase 11).
 *
 *   signedOut ──requestCode──▶ codeSent ──verify──▶ signedIn
 *                                 │  └─SIGNUP_DETAILS_REQUIRED─▶ needsDetails ──verify(+details)──▶ signedIn
 *                                 └─wrong / expired code: stays, with an error key
 *
 * Errors become i18n keys, so screens never show server text they do not control.
 * @typedef {{ step: 'signedOut' } | { step: 'codeSent', email: string } | { step: 'needsDetails', email: string, code: string } | { step: 'signedIn' }} AuthState
 */

/** Server error codes → i18n keys shown to the user. */
const ERROR_KEYS = new Map([
  ['EMAIL_DOMAIN_NOT_ALLOWED', 'auth.email.notAllowed'],
  ['VALIDATION_FAILED', 'auth.email.invalid'],
  ['OTP_INVALID', 'auth.code.invalid'],
  ['OTP_EXPIRED', 'auth.code.expired'],
  ['OTP_ATTEMPTS_EXHAUSTED', 'auth.code.expired'],
  ['UNDERAGE', 'auth.signup.underage'],
  ['ACCOUNT_BANNED', 'auth.banned'],
  ['ACCOUNT_PENDING_REVIEW', 'auth.pendingReview'],
  ['RATE_LIMITED', 'auth.rateLimited'],
  ['NETWORK', 'common.offline'],
]);

/** @param {unknown} error @returns {import('@vouch/i18n').MessageKey} */
export function errorKey(error) {
  const code = error instanceof ApiError ? error.code : '';
  return /** @type {any} */ (ERROR_KEYS.get(code) ?? 'common.error');
}

/**
 * @param {{
 *   client: import('@vouch/api-client').ApiClient,
 *   session: import('@vouch/api-client').Session,
 *   platform: 'ios' | 'android' | 'web',
 *   appVersion: string,
 *   captchaToken: () => Promise<string>,
 * }} deps
 */
export function createAuthFlow({ client, session, platform, appVersion, captchaToken }) {
  return {
    /** @param {string} email @returns {Promise<AuthState>} */
    async requestCode(email) {
      await requestOtp(client, { body: { email, turnstileToken: await captchaToken() } });
      return { step: 'codeSent', email };
    },
    /**
     * Verifies the code. A new account answers SIGNUP_DETAILS_REQUIRED (the code is kept) and
     * the flow asks for the birth date and consent.
     * @param {{ email: string, code: string, signup?: { birthDate: string, consent: { noticeVersion: string, purposes: string[] } } }} input
     * @returns {Promise<AuthState>}
     */
    async verify({ email, code, signup }) {
      try {
        const result = await verifyOtp(client, {
          body: {
            email,
            code,
            device: { platform, appVersion },
            tokenTransport: session.transport,
            ...(signup ? { signup } : {}),
          },
        });
        await session.accept(result.tokens);
        return { step: 'signedIn' };
      } catch (error) {
        if (error instanceof ApiError && error.code === 'SIGNUP_DETAILS_REQUIRED') {
          return { step: 'needsDetails', email, code };
        }
        throw error;
      }
    },
  };
}
