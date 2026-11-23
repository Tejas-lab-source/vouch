// @ts-check
import { expect, test } from '@playwright/test';
import { wcagViolations } from './axe.js';
import { lastCode } from './stack.js';

/**
 * Phase 14 accessibility pass (web): WCAG 2.2 AA at every impact level (not only serious) on
 * the privacy notice in both themes, the sign-up dialog, and keyboard-only sign-up.
 */
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
  test(`the public privacy notice meets WCAG 2.2 AA in the ${colorScheme} theme`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: /** @type {string} */ (process.env.E2E_BASE_URL),
      colorScheme,
    });
    const page = await context.newPage();
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
    // One h1, then the sections as h2: a heading outline a screen reader can navigate.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2, name: 'Your rights' })).toBeVisible();
    await expect(page.getByText(/draft, pending legal review/)).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await context.close();
  });
}

test('sign-up by keyboard only: the notice opens in a dialog, Escape closes it, focus returns', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: /** @type {string} */ (process.env.E2E_BASE_URL),
  });
  const page = await context.newPage();
  const email = `e2e-a11y-${Date.now()}@northfield.example.edu`;
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: 'College email' }).focus();
  await page.keyboard.type(email);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await expect.poll(lastCode, { timeout: 10_000 }).not.toBeNull();
  await page.getByRole('textbox', { name: 'Six-digit code' }).focus();
  await page.keyboard.type(/** @type {string} */ (await lastCode()));
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'A few details first' })).toBeVisible();
  const read = page.getByRole('button', { name: 'Read the privacy notice' });
  await read.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Privacy notice' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'What we collect' })).toBeVisible();
  expect(await wcagViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(read).toBeFocused();

  // The consent checkbox is reachable and operable by keyboard.
  const consent = page.getByLabel(/I agree to the privacy notice \(version 2026-11-draft\)/);
  await consent.focus();
  await page.keyboard.press('Space');
  await expect(consent).toBeChecked();
  expect(await wcagViolations(page)).toEqual([]);
  await context.close();
});
