// @ts-check
import { expect, test } from '@playwright/test';
import { lastCode } from './stack.js';
import { seriousViolations } from './axe.js';

const SHOTS = new URL('../../../docs/phases/assets/', import.meta.url);

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('a new student signs in with the emailed code and lands in onboarding', async ({
  browser,
}) => {
  const baseURL = /** @type {string} */ (process.env.E2E_BASE_URL);
  const context = await browser.newContext({ baseURL, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const email = `e2e-${Date.now()}@northfield.example.edu`;

  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole('heading', { name: 'Sign in with your college email' }),
  ).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.screenshot({ path: new URL('phase11-web-sign-in.png', SHOTS).pathname });

  await page.getByRole('textbox', { name: 'College email' }).fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await expect.poll(lastCode, { timeout: 10_000 }).not.toBeNull();
  await page
    .getByRole('textbox', { name: 'Six-digit code' })
    .fill(/** @type {string} */ (await lastCode()));
  await page.getByRole('button', { name: 'Continue' }).click();

  // First sign-in: birth date and consent.
  await expect(page.getByRole('heading', { name: 'A few details first' })).toBeVisible();
  await page.getByLabel('Date of birth').fill('2004-05-17');
  await page.getByLabel(/I agree to the privacy notice/).check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  // The home shell waits until onboarding is done (Phase 12); a reload keeps the session (the
  // httpOnly refresh cookie) and resumes onboarding.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  await context.close();
});

test('a wrong code is refused with a readable message', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  const page = await context.newPage();
  await page.goto('/sign-in');
  await page
    .getByRole('textbox', { name: 'College email' })
    .fill(`e2e-wrong-${Date.now()}@northfield.example.edu`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('textbox', { name: 'Six-digit code' }).fill('000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('That code is not right.');
  await context.close();
});

for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
  test(`the UI kit has no serious accessibility violations in the ${colorScheme} theme`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL,
      colorScheme,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto('/ui-kit');
    await expect(page.getByRole('heading', { name: 'UI kit' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.screenshot({
      path: new URL(`phase11-ui-kit-${colorScheme}.png`, SHOTS).pathname,
      fullPage: true,
    });
    await context.close();
  });
}

test('an unknown page shows the 404', async ({ page }) => {
  await page.goto(`${process.env.E2E_BASE_URL}/no-such-page`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
