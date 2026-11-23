// @ts-check
import { expect, test } from '@playwright/test';
import { seriousViolations } from './axe.js';
import { BASE, onboard, SHOTS, waitForCard } from './flows.js';
import { codeAfter, codeCount } from './stack.js';

test('two new students onboard with photos, see each other, like each other, and both see the match', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const asha = await onboard(browser, {
    name: 'Asha',
    gender: 'Woman',
    seeking: 'Man',
    shots: true,
  });
  const kabir = await onboard(browser, {
    name: 'Kabir',
    gender: 'Man',
    seeking: 'Woman',
    colorScheme: 'dark',
  });

  // Asha sees Kabir's card (400 px photo) and likes him with the keyboard (→).
  const kabirCard = await waitForCard(asha.page, 'Kabir');
  await expect(kabirCard.getByRole('img').first()).toHaveAttribute('src', /_400\.webp$/);
  expect(await seriousViolations(asha.page)).toEqual([]);
  await asha.page.screenshot({ path: new URL('phase12-web-deck.png', SHOTS).pathname });
  await kabirCard.getByRole('button', { name: 'View profile' }).click();
  await expect(kabirCard.getByRole('img', { name: /Photo 2 of Kabir/ })).toHaveAttribute(
    'src',
    /_1080\.webp$/,
  );
  await asha.page.keyboard.press('ArrowRight');
  await expect(kabirCard).toBeHidden();

  // Kabir sees Asha and likes her with the button: both get the match moment.
  const ashaCard = await waitForCard(kabir.page, 'Asha');
  await ashaCard.page().getByRole('button', { name: 'Like', exact: true }).click();
  const kabirDialog = kabir.page.getByRole('dialog', { name: 'It’s a match!' });
  await expect(kabirDialog).toBeVisible();
  await expect(kabirDialog).toContainText('You and Asha like each other.');
  expect(await seriousViolations(kabir.page)).toEqual([]);
  await kabir.page.screenshot({ path: new URL('phase12-web-match-dark.png', SHOTS).pathname });
  // Asha is told live over the socket (match.new).
  const ashaDialog = asha.page.getByRole('dialog', { name: 'It’s a match!' });
  await expect(ashaDialog).toBeVisible({ timeout: 15_000 });
  await ashaDialog.getByRole('button', { name: 'Send a message' }).click();
  await expect(asha.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
  await expect(asha.page.getByRole('heading', { name: 'Kabir', exact: true })).toBeVisible();

  // Both match lists show the other person.
  await kabirDialog.getByRole('button', { name: 'Keep discovering' }).click();
  for (const [who, other] of /** @type {const} */ ([
    [asha, 'Kabir'],
    [kabir, 'Asha'],
  ])) {
    await who.page.getByRole('link', { name: 'Matches' }).click();
    await expect(who.page.getByRole('button', { name: `Open chat with ${other}` })).toBeVisible();
    expect(await seriousViolations(who.page)).toEqual([]);
  }
  await asha.page.screenshot({ path: new URL('phase12-web-matches.png', SHOTS).pathname });

  // Profile page renders with both photos; axe clean.
  await kabir.page.getByRole('link', { name: 'Profile' }).click();
  await expect(kabir.page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await expect(kabir.page.getByRole('img', { name: /^Your photo/ })).toHaveCount(2);
  expect(await seriousViolations(kabir.page)).toEqual([]);

  // Kabir unmatches (with confirmation): the match leaves both lists.
  await kabir.page.getByRole('link', { name: 'Matches' }).click();
  await kabir.page.getByRole('button', { name: 'Unmatch' }).click();
  const confirm = kabir.page.getByRole('dialog', { name: 'Unmatch Asha?' });
  await confirm.getByRole('button', { name: 'Unmatch' }).click();
  await expect(kabir.page.getByRole('heading', { name: 'No matches yet' })).toBeVisible();
  await asha.page.reload();
  await expect(asha.page.getByRole('heading', { name: 'No matches yet' })).toBeVisible();

  await asha.context.close();
  await kabir.context.close();
});

test('an under-18 birth date is refused at sign-up with a clear message', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE() });
  const page = await context.newPage();
  await page.goto('/sign-in');
  await page
    .getByRole('textbox', { name: 'College email' })
    .fill(`e2e-young-${Date.now()}@northfield.example.edu`);
  const before = await codeCount();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => codeAfter(before), { timeout: 10_000 }).not.toBeNull();
  await page
    .getByRole('textbox', { name: 'Six-digit code' })
    .fill(/** @type {string} */ (await codeAfter(before)));
  await page.getByRole('button', { name: 'Continue' }).click();
  const year = new Date().getUTCFullYear() - 17;
  await page.getByLabel('Date of birth').fill(`${year}-01-01`);
  await page.getByLabel(/I agree to the privacy notice/).check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('alert')).toHaveText('You must be 18 or older to use Vouch.');
  await expect(page).toHaveURL(/\/sign-in$/);
  await context.close();
});
