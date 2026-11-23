// @ts-check
import { expect } from '@playwright/test';
import { seriousViolations } from './axe.js';
import { codeAfter, codeCount } from './stack.js';

export const SHOTS = new URL('../../../docs/phases/assets/', import.meta.url);
export const BASE = () => /** @type {string} */ (process.env.E2E_BASE_URL);
/** Seeded synthetic users are 18–25; these two are older and look for 30–40, so their decks hold each other. */
const BIRTH_DATE = '1990-04-12';

/**
 * A photo-like JPEG (gradients and shapes, 1600×2000) drawn in the page, so the browser's own
 * resize path (to 2048 px) runs on it.
 * @param {import('@playwright/test').Page} page @param {number} hue
 */
export async function makeJpeg(page, hue) {
  const base64 = await page.evaluate(async (h) => {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 2000;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const gradient = ctx.createLinearGradient(0, 0, 1600, 2000);
    gradient.addColorStop(0, `hsl(${h}, 70%, 60%)`);
    gradient.addColorStop(1, `hsl(${(h + 120) % 360}, 60%, 30%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1600, 2000);
    for (let i = 0; i < 40; i += 1) {
      ctx.fillStyle = `hsla(${(h + i * 9) % 360}, 80%, 50%, 0.4)`;
      ctx.beginPath();
      ctx.arc((i * 211) % 1600, (i * 347) % 2000, 60 + (i % 7) * 25, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    const bytes = new Uint8Array(await /** @type {Blob} */ (blob).arrayBuffer());
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  }, hue);
  return Buffer.from(base64, 'base64');
}

/**
 * Signs up a new student and completes onboarding through the UI.
 * @param {import('@playwright/test').Browser} browser
 * @param {{ name: string, gender: 'Woman' | 'Man', seeking: 'Woman' | 'Man', colorScheme?: 'light' | 'dark', shots?: boolean }} who
 * @returns {Promise<{ context: import('@playwright/test').BrowserContext, page: import('@playwright/test').Page, email: string }>}
 */
export async function onboard(
  browser,
  { name, gender, seeking, colorScheme = 'light', shots = false },
) {
  const context = await browser.newContext({ baseURL: BASE(), colorScheme, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    throw error;
  });
  const email = `e2e-${name.toLowerCase()}-${Date.now()}@northfield.example.edu`;
  await page.goto('/');
  await page.getByRole('textbox', { name: 'College email' }).fill(email);
  const before = await codeCount();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => codeAfter(before), { timeout: 10_000 }).not.toBeNull();
  await page
    .getByRole('textbox', { name: 'Six-digit code' })
    .fill(/** @type {string} */ (await codeAfter(before)));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Date of birth').fill(BIRTH_DATE);
  await page.getByLabel(/I agree to the privacy notice/).check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  // 1. About you
  await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole('textbox', { name: 'First name' }).fill(name);
  await page.getByRole('radio', { name: gender, exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  // 2. Who to meet
  await expect(page.getByRole('heading', { name: 'Who would you like to meet?' })).toBeVisible();
  await page.getByRole('checkbox', { name: seeking, exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  // 3. Ages
  await expect(page.getByRole('heading', { name: 'Which ages?' })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'From' }).fill('30');
  await page.getByRole('spinbutton', { name: 'To' }).fill('40');
  await page.getByRole('button', { name: 'Continue' }).click();
  // 4. Photos: two real JPEGs through the browser (resize → presign → PUT with CORS → confirm).
  await expect(page.getByRole('heading', { name: 'Add your photos' })).toBeVisible();
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  await page.getByTestId('photo-input').setInputFiles([
    { name: 'one.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 20) },
    { name: 'two.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 200) },
  ]);
  await expect(page.getByText('Approved', { exact: true })).toHaveCount(2, { timeout: 30_000 });
  expect(await seriousViolations(page)).toEqual([]);
  if (shots) await page.screenshot({ path: new URL('phase12-web-photos.png', SHOTS).pathname });
  // Reorder: the second photo becomes the main one (and stays so after a reload).
  const photos = page.getByRole('img', { name: /^Your photo/ });
  const secondSrc = await photos.nth(1).getAttribute('src');
  await page.getByRole('button', { name: 'Move photo 2 earlier' }).click();
  await expect(photos.nth(0)).toHaveAttribute('src', /** @type {string} */ (secondSrc));
  // Onboarding resumes where it was after a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Add your photos' })).toBeVisible();
  await expect(photos.nth(0)).toHaveAttribute('src', /** @type {string} */ (secondSrc));
  await continueButton.click();
  await expect(page.getByRole('heading', { name: 'You are all set' })).toBeVisible();
  await page.getByRole('button', { name: 'Start discovering' }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page, email };
}

/**
 * Waits until `name`'s card is on top of the deck. Other test users (same age band) are passed
 * over, and a fresh deck is requested while it is empty (decks are rebuilt in the background
 * when a profile becomes active).
 * @param {import('@playwright/test').Page} page @param {string} name
 */
export async function waitForCard(page, name) {
  // The card's accessible name is "Name, age".
  const card = page.getByRole('article', { name: `${name}, ` });
  await expect(async () => {
    if (await card.isVisible()) return;
    const other = page.getByRole('article');
    if (await other.isVisible()) {
      await page.getByRole('button', { name: 'Pass', exact: true }).click();
    } else {
      const again = page.getByRole('button', { name: 'Check again' });
      if (await again.isVisible()) await again.click();
    }
    await expect(card).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  return card;
}

/**
 * Two new students who match: both onboard, each likes the other, and both close the match
 * moment. Returns their contexts and pages, on the home shell.
 * @param {import('@playwright/test').Browser} browser
 * @param {{ woman: string, man: string, colorScheme?: 'light' | 'dark' }} names
 */
export async function matchedPair(browser, { woman, man, colorScheme = 'light' }) {
  const a = await onboard(browser, { name: woman, gender: 'Woman', seeking: 'Man', colorScheme });
  const b = await onboard(browser, { name: man, gender: 'Man', seeking: 'Woman', colorScheme });
  await (
    await waitForCard(a.page, man)
  )
    .page()
    .getByRole('button', { name: 'Like', exact: true })
    .click();
  await (
    await waitForCard(b.page, woman)
  )
    .page()
    .getByRole('button', { name: 'Like', exact: true })
    .click();
  for (const who of [a, b]) {
    const dialog = who.page.getByRole('dialog', { name: 'It’s a match!' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Keep discovering' }).click();
  }
  return { a, b };
}

/**
 * Opens the chat with `name` from the Chats tab.
 * @param {import('@playwright/test').Page} page @param {string} name
 */
export async function openChat(page, name) {
  await page.getByRole('link', { name: 'Chats', exact: true }).click();
  // The row's accessible name starts with the person's name (then the preview).
  await page.getByRole('list').getByRole('button', { name }).first().click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return page.getByRole('log', { name: `Messages with ${name}` });
}
