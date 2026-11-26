// @ts-check
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildLanding } from '../../../scripts/landing-build.js';
import { seriousViolations } from '../e2e/axe.js';
import { BASE, makeJpeg, matchedPair, onboard, openChat, waitForCard } from '../e2e/flows.js';
import { codeAfter, codeCount } from '../e2e/stack.js';
import { totp } from './totp.js';

/**
 * Design screenshots (design update, docs/design/): every mobile screen at 390×844 from the
 * Expo web export, the web landing, swipe deck and chat at 1440×900, and two admin pages, in
 * light and dark. `DESIGN_SHOTS=before|after` names the folder under docs/design/screenshots/.
 * All data is synthetic (the e2e stack: Testcontainers, seeded colleges, generated photos).
 *
 *   pnpm --filter @vouch/web design:shots            # DESIGN_SHOTS=after by default
 */
const SET = process.env.DESIGN_SHOTS ?? 'after';
/** Which shots to take (`web`, `admin`, `mobile`); the test data is created either way. */
const PARTS = new Set((process.env.DESIGN_PARTS ?? 'web,admin,mobile').split(','));
const OUT = new URL(`../../../docs/design/screenshots/${SET}/`, import.meta.url);
const MOBILE = () => /** @type {string} */ (process.env.E2E_MOBILE_URL);
const ADMIN = () => JSON.parse(/** @type {string} */ (process.env.E2E_ADMIN));
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
/** Axe findings per screen, written next to the shots. @type {Map<string, string[]>} */
const AXE = new Map();

test.describe.configure({ mode: 'serial', timeout: 900_000 });

/**
 * Saves `name-light.jpg` (and `name-dark.jpg` when `dark`) after the page settles, and records
 * serious axe violations for each theme.
 * @param {import('@playwright/test').Page} page @param {string} name
 * @param {{ dark?: boolean, fullPage?: boolean, clip?: { x: number, y: number, width: number, height: number } }} [options]
 */
async function shot(page, name, { dark = true, fullPage = false, clip } = {}) {
  if (!PARTS.has(name.slice(0, name.indexOf('-')))) return;
  for (const scheme of dark ? ['light', 'dark'] : ['light']) {
    await page.emulateMedia({ colorScheme: /** @type {'light' | 'dark'} */ (scheme) });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: new URL(`${name}-${scheme}.jpg`, OUT).pathname,
      type: 'jpeg',
      quality: 82,
      fullPage,
      ...(clip ? { clip } : {}),
    });
    AXE.set(`${name}-${scheme}`, await seriousViolations(page));
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/**
 * A desktop-sized page in its own context (axe needs a context the test created).
 * @param {import('@playwright/test').Browser} browser @param {string} [baseURL]
 */
async function desktop(browser, baseURL) {
  const context = await browser.newContext({ baseURL, viewport: DESKTOP, deviceScaleFactor: 2 });
  return context.newPage();
}

/** A phone-sized context on the mobile web export. @param {import('@playwright/test').Browser} browser */
async function phone(browser) {
  const context = await browser.newContext({
    baseURL: MOBILE(),
    viewport: PHONE,
    deviceScaleFactor: 2,
    hasTouch: true,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    throw error;
  });
  return page;
}

/**
 * Mobile sign-in up to the code step's result. Handles the welcome step when the build has one.
 * @param {import('@playwright/test').Page} page @param {string} email @param {string} [prefix]
 */
async function mobileSignIn(page, email, prefix) {
  await page.goto('/');
  const start = page.getByRole('button', { name: /Get started|I already have an account/ }).first();
  const field = page.getByLabel('College email', { exact: true });
  await expect(start.or(field).first()).toBeVisible({ timeout: 30_000 });
  if (prefix) await shot(page, `${prefix}01-welcome`);
  if (await start.isVisible()) await start.click();
  await field.fill(email);
  if (prefix) await shot(page, `${prefix}02-sign-in`);
  const before = await codeCount();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => codeAfter(before), { timeout: 15_000 }).not.toBeNull();
  const code = page.getByLabel('Six-digit code', { exact: true });
  await code.fill(/** @type {string} */ (await codeAfter(before)));
  if (prefix) await shot(page, `${prefix}03-enter-code`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

test.beforeAll(async () => {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(OUT, { recursive: true });
});

test.afterAll(async () => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    new URL('axe.json', OUT),
    `${JSON.stringify(Object.fromEntries(AXE), null, 2)}\n`,
  );
});

test('design screenshots: web, admin and every mobile screen', async ({ browser }) => {
  // --- Web: landing, sign-in, deck, chat (desktop) -------------------------------------
  const landing = await desktop(browser);
  const site = await mkdtemp(join(tmpdir(), 'landing-'));
  await buildLanding(site, {
    SITE_URL: 'https://example.app',
    WEB_URL: 'https://app.example.app',
    GRIEVANCE_EMAIL: 'grievance@example.app',
  });
  const types = new Map([
    ['.html', 'text/html'],
    ['.svg', 'image/svg+xml'],
    ['.woff2', 'font/woff2'],
  ]);
  await landing.route('http://landing.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = join(site, path === '/' ? 'index.html' : path);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the temporary build
    const body = await readFile(file).catch(() => null);
    if (!body) return route.fulfill({ status: 404 });
    return route.fulfill({ body, contentType: types.get(extname(file)) ?? 'text/plain' });
  });
  await landing.goto('http://landing.test/');
  await landing.evaluate(() => document.fonts.ready);
  await shot(landing, 'web-01-landing', { fullPage: true });
  await landing.close();

  const signIn = await desktop(browser, BASE());
  await signIn.goto('/sign-in');
  await expect(signIn.getByRole('textbox', { name: 'College email' })).toBeVisible();
  await shot(signIn, 'web-02-sign-in');
  await signIn.close();

  // Ananya and Arjun match and chat; Rohan sees Ananya in his deck.
  const { a: ananya, b: arjun } = await matchedPair(browser, { woman: 'Ananya', man: 'Arjun' });
  await openChat(ananya.page, 'Arjun');
  await openChat(arjun.page, 'Ananya');
  const lines = [
    [ananya, 'Hey Arjun! How’s college?'],
    [arjun, 'Hey! Great 😄 Wbu?'],
    [ananya, 'Same here! Coffee later?'],
    [arjun, 'Sure! After the 4 pm lecture?'],
  ];
  for (const [who, text] of lines) {
    const page = /** @type {any} */ (who).page;
    await page.getByRole('textbox', { name: 'Message' }).fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText(/** @type {string} */ (text))).toBeVisible();
  }
  await expect(ananya.page.getByText('Sure! After the 4 pm lecture?')).toBeVisible();
  await ananya.page.setViewportSize(DESKTOP);
  await shot(ananya.page, 'web-04-chat');

  const rohan = await onboard(browser, { name: 'Rohan', gender: 'Man', seeking: 'Woman' });
  await rohan.page.setViewportSize(DESKTOP);
  await waitForCard(rohan.page, 'Ananya');
  await shot(rohan.page, 'web-03-swipe-deck');
  await rohan.page.getByRole('button', { name: 'Like', exact: true }).click();

  // A synthetic report for the admin panel shot.
  await ananya.page.getByRole('button', { name: 'Report', exact: true }).click();
  const report = ananya.page.getByRole('dialog', { name: 'Report Arjun' });
  await report.getByRole('radio', { name: 'Spam or scam' }).check();
  await report
    .getByRole('textbox', { name: /Anything else/ })
    .fill('Synthetic report for a design screenshot.');
  await report.getByRole('button', { name: 'Send report' }).click();
  await expect(report.getByRole('status')).toBeVisible();
  await ananya.page.keyboard.press('Escape');

  // --- Admin: sign-in and a panel ------------------------------------------------------
  const staff = await desktop(browser, process.env.E2E_ADMIN_URL);
  await staff.goto('/');
  await expect(staff.getByRole('textbox', { name: 'Staff email' })).toBeVisible();
  await shot(staff, 'admin-01-sign-in');
  const admin = ADMIN();
  await staff.getByRole('textbox', { name: 'Staff email' }).fill(admin.email);
  await staff.getByLabel('Password').fill(admin.password);
  await staff.getByRole('textbox', { name: 'Authenticator code' }).fill(totp(admin.totpSecret));
  await staff.getByRole('button', { name: 'Sign in' }).click();
  await staff
    .getByRole('navigation')
    .getByRole('button', { name: /^Reports/ })
    .click();
  await expect(staff.getByRole('row').filter({ hasText: 'spam' }).first()).toBeVisible();
  await shot(staff, 'admin-02-reports');
  await staff.close();

  // --- Mobile: a new student, screens 1–5 ----------------------------------------------
  const diya = await phone(browser);
  await mobileSignIn(diya, `e2e-diya-${Date.now()}@northfield.example.edu`, 'mobile-');
  await diya.getByLabel('Date of birth', { exact: true }).fill('2004-11-07');
  await diya.getByRole('switch').first().click();
  await shot(diya, 'mobile-03b-sign-up-details');
  await diya.getByRole('button', { name: 'Create my account' }).click();
  await expect(diya.getByRole('heading', { name: 'About you' })).toBeVisible({ timeout: 20_000 });
  await diya.getByLabel('First name', { exact: true }).fill('Diya');
  await diya.getByRole('radio', { name: 'Woman', exact: true }).click();
  await shot(diya, 'mobile-04-onboarding');
  await diya.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(diya.getByRole('heading', { name: 'Who would you like to meet?' })).toBeVisible();
  await diya.getByRole('checkbox', { name: 'Man', exact: true }).click();
  await shot(diya, 'mobile-04b-onboarding-who', { dark: false });
  await diya.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(diya.getByRole('heading', { name: 'Which ages?' })).toBeVisible();
  await shot(diya, 'mobile-04c-onboarding-ages', { dark: false });
  await diya.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(diya.getByRole('heading', { name: 'Add your photos' })).toBeVisible();
  const chooser = diya.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null);
  await diya.getByRole('button', { name: 'Add photos' }).click();
  const files = await chooser;
  if (files) {
    await files.setFiles([
      { name: 'one.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(diya, 330) },
      { name: 'two.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(diya, 30) },
    ]);
    await expect(diya.getByText('Approved', { exact: true })).toHaveCount(2, { timeout: 45_000 });
  }
  await shot(diya, 'mobile-05-add-photos', { fullPage: true });
  await diya.context().close();

  // --- Mobile: Ananya, screens 6–14 ----------------------------------------------------
  const me = await phone(browser);
  await mobileSignIn(me, ananya.email);
  // Onboarding progress is kept per device: on a new one, confirm the remaining steps.
  const tabs = me.getByText('Discover', { exact: true }).first();
  await expect(async () => {
    if (await tabs.isVisible()) return;
    const done = me.getByRole('button', { name: 'Start discovering' });
    const next = me.getByRole('button', { name: 'Continue', exact: true });
    if (await done.isVisible()) await done.click();
    else if (await next.isVisible()) await next.click();
    await expect(tabs).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 60_000 });
  const card = me.getByText(/^Rohan, \d+$/).first();
  await expect(async () => {
    if (await card.isVisible()) return;
    const again = me.getByRole('button', { name: 'Check again' });
    if (await again.isVisible()) await again.click();
    await expect(card).toBeVisible({ timeout: 1000 });
  })
    .toPass({ timeout: 60_000 })
    .catch(async (error) => {
      await me.screenshot({ path: new URL('debug-deck.png', OUT).pathname });
      throw error;
    });
  await shot(me, 'mobile-06-swipe-deck');
  await shot(me, 'mobile-14-bottom-nav', {
    clip: { x: 0, y: PHONE.height - 110, width: PHONE.width, height: 110 },
  });
  await me.getByRole('button', { name: 'View profile' }).first().click();
  await shot(me, 'mobile-07-full-profile', { fullPage: true });
  await me.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(me.getByText('It’s a match!')).toBeVisible({ timeout: 15_000 });
  await shot(me, 'mobile-08-its-a-match');
  await me.getByRole('button', { name: 'Keep discovering' }).click();

  await me.goto('/matches');
  await expect(me.getByText('Arjun').first()).toBeVisible({ timeout: 20_000 });
  await shot(me, 'mobile-09-matches');
  await me.goto('/chats');
  await expect(me.getByText(/After the 4 pm lecture/).first()).toBeVisible({ timeout: 20_000 });
  await shot(me, 'mobile-10-chats');
  await me
    .getByRole('button', { name: /^Arjun/ })
    .first()
    .click();
  await expect(me.getByText('Same here! Coffee later?')).toBeVisible({ timeout: 20_000 });
  await shot(me, 'mobile-11-chat');
  await me.goto('/profile');
  await expect(me.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
  await shot(me, 'mobile-12-my-profile');
  await shot(me, 'mobile-12b-my-profile-full', { fullPage: true, dark: false });
  await me.goto('/settings');
  await expect(me.getByText('Share read receipts').first()).toBeVisible({ timeout: 20_000 });
  await shot(me, 'mobile-13-settings');
  await shot(me, 'mobile-13b-settings-full', { fullPage: true, dark: false });
  await me.context().close();

  for (const who of [ananya, arjun, rohan]) await who.context.close();
});
