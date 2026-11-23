// @ts-check
import { TURNSTILE_SITE_KEY } from '../config/index.js';

/**
 * A captcha token for `POST /v1/auth/otp`. Turnstile is wired in Phase 15 (with its site key);
 * until then the development verifier accepts any token, and production refuses to start
 * with it (`CAPTCHA_PROVIDER=dev` is development-only).
 */
export async function captchaToken() {
  if (TURNSTILE_SITE_KEY) throw new Error('Turnstile is not wired yet (Phase 15)');
  return 'dev';
}
