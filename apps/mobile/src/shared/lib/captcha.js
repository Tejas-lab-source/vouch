// @ts-check

/**
 * The captcha token for `POST /v1/auth/otp`. Mobile attestation or Turnstile is wired in
 * Phase 15; the development verifier accepts any token (refused in production).
 */
export const captchaToken = async () => 'dev';
