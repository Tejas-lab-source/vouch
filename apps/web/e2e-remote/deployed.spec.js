// @ts-check
import { expect, test } from '@playwright/test';

const WEB = process.env.REMOTE_WEB_URL ?? '';
const ADMIN = process.env.REMOTE_ADMIN_URL ?? '';
const API = process.env.REMOTE_API_URL ?? '';

/**
 * Collects page errors, CSP violations and failed API calls for one page.
 * @param {import('@playwright/test').Page} page
 */
function watch(page) {
  /** @type {string[]} */
  const problems = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|CORS/i.test(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (API && request.url().startsWith(API)) problems.push(`failed: ${request.url()}`);
  });
  return problems;
}

test('the web app loads, reaches the API across origins and validates sign-in input', async ({
  page,
}) => {
  test.skip(!WEB || !API, 'REMOTE_WEB_URL and REMOTE_API_URL are required');
  const problems = watch(page);
  const config = page.waitForResponse((r) => r.url().startsWith(`${API}/v1/config`));
  await page.goto(WEB);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole('heading', { name: 'Sign in with your college email' }),
  ).toBeVisible();
  expect((await config).status()).toBe(200);

  // Client-side validation: nothing is sent for a malformed address.
  let sent = false;
  page.on('request', (r) => {
    if (r.url().includes('/v1/auth/otp')) sent = true;
  });
  await page.getByRole('textbox', { name: 'College email' }).fill('student@localhost');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  expect(sent).toBe(false);
  expect(problems).toEqual([]);
});

test('the admin app loads its sign-in page', async ({ page }) => {
  test.skip(!ADMIN, 'REMOTE_ADMIN_URL is not set');
  const problems = watch(page);
  const response = await page.goto(ADMIN);
  // The admin site is IP-restricted (WAF); a runner outside the allowlist sees 403, which is
  // the intended answer and is reported, not failed.
  if (response?.status() === 403) {
    test
      .info()
      .annotations.push({ type: 'note', description: 'admin blocked by the IP allowlist' });
    return;
  }
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  expect(problems).toEqual([]);
});
