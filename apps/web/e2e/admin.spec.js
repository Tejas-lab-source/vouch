// @ts-check
import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { seriousViolations } from './axe.js';
import { matchedPair, openChat, SHOTS } from './flows.js';

const ADMIN = () => JSON.parse(/** @type {string} */ (process.env.E2E_ADMIN));

/** RFC 4648 base32 → bytes. @param {string} text */
function base32(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of text) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

/** The current RFC 6238 code (SHA-1, 30 s, 6 digits). @param {string} secret */
function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

test.describe.configure({ timeout: 240_000 });

test('a reported user is banned from the admin console, with the audit entry shown, and is signed out', async ({
  browser,
}) => {
  const { a: priya, b: vikram } = await matchedPair(browser, { woman: 'Priya', man: 'Vikram' });
  // Priya reports Vikram from their chat.
  await openChat(priya.page, 'Vikram');
  await openChat(vikram.page, 'Priya');
  await priya.page.getByRole('button', { name: 'Report', exact: true }).click();
  const report = priya.page.getByRole('dialog', { name: 'Report Vikram' });
  await report.getByRole('radio', { name: 'Harassment' }).check();
  await report.getByRole('textbox', { name: /Anything else/ }).fill('Rude messages.');
  await report.getByRole('button', { name: 'Send report' }).click();
  await expect(report.getByRole('status')).toHaveText('Thanks. Our team will review your report.');

  // The admin signs in with password and TOTP.
  const staff = await browser.newContext({
    baseURL: process.env.E2E_ADMIN_URL,
    deviceScaleFactor: 2,
  });
  const page = await staff.newPage();
  await page.goto('/');
  // Without a session only the sign-in form exists (no panel route is reachable).
  await expect(page.getByRole('navigation')).toHaveCount(0);
  const admin = ADMIN();
  await page.getByRole('textbox', { name: 'Staff email' }).fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('textbox', { name: 'Authenticator code' }).fill(totp(admin.totpSecret));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Reports/ })
    .click();
  const row = page.getByRole('row').filter({ hasText: 'harassment' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Rude messages.')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.screenshot({
    path: new URL('phase13-admin-report.png', SHOTS).pathname,
    fullPage: true,
  });

  // Ban, with a note; the audit entry is shown.
  await row.getByRole('button', { name: 'Ban user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ban user?' });
  await dialog.getByRole('textbox', { name: 'Note for the audit log' }).fill('Harassment in chat.');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog.getByRole('status')).toContainText('by E2E Admin');
  expect(await seriousViolations(page)).toEqual([]);
  await page.screenshot({ path: new URL('phase13-admin-audit.png', SHOTS).pathname });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  // The other panels render from their definitions too (audit log, flags, user lookup).
  for (const name of [/^Audit log/, /^Feature flags/, /^Bans/]) {
    await page.getByRole('navigation').getByRole('button', { name }).click();
    await expect(
      page.getByRole('table').or(page.getByText('Nothing here right now.')),
    ).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  }
  // The ban is listed under Bans with its note as the reason.
  await expect(page.getByRole('cell', { name: 'Harassment in chat.' })).toBeVisible();

  // Vikram is signed out (sessions revoked; the socket is closed) and cannot sign back in.
  await vikram.page.reload();
  await expect(vikram.page).toHaveURL(/\/sign-in$/, { timeout: 30_000 });
  // Priya's chat with him has ended.
  await expect(priya.page.getByRole('status').filter({ hasText: 'ended' })).toHaveText(
    'This conversation has ended.',
    {
      timeout: 30_000,
    },
  );

  await staff.close();
  await priya.context.close();
  await vikram.context.close();
});
