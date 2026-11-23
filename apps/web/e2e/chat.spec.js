// @ts-check
import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';
import { seriousViolations } from './axe.js';
import { BASE, matchedPair, openChat, SHOTS } from './flows.js';
import { codeAfter, codeCount } from './stack.js';

/**
 * A second device for an existing user, signed in over the API (body token transport), with a
 * socket: used to send many messages quickly.
 * @param {string} email
 */
async function secondDevice(email) {
  const headers = { 'content-type': 'application/json', 'x-app-version': '1.0.0' };
  const before = await codeCount();
  const otp = await fetch(`${BASE()}/v1/auth/otp`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ email, turnstileToken: 'dev' }),
  });
  expect(otp.ok).toBe(true);
  await expect.poll(() => codeAfter(before), { timeout: 10_000 }).not.toBeNull();
  const verified = await fetch(`${BASE()}/v1/auth/verify`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({
      email,
      code: await codeAfter(before),
      device: { platform: 'web', appVersion: '1.0.0' },
      tokenTransport: 'body',
    }),
  });
  const { tokens } = await verified.json();
  const socket = io(BASE(), { transports: ['websocket'], auth: { token: tokens.accessToken } });
  await new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(undefined));
    socket.once('connect_error', reject);
  });
  return socket;
}

test.describe.configure({ timeout: 240_000 });

test('two users chat in real time; read states; messages sent while offline arrive once, in order', async ({
  browser,
}) => {
  const { a: mira, b: arjun } = await matchedPair(browser, { woman: 'Mira', man: 'Arjun' });
  const miraLog = await openChat(mira.page, 'Arjun');
  const arjunLog = await openChat(arjun.page, 'Mira');
  expect(await seriousViolations(mira.page)).toEqual([]);

  // Mira writes; Arjun sees it live.
  const composer = mira.page.getByRole('textbox', { name: 'Message' });
  await composer.fill('Hi Arjun!');
  await composer.press('Enter');
  await expect(arjunLog.getByText('Hi Arjun!')).toBeVisible();
  // Read receipts are off by default (Phase 14, ADR 0024): Mira sees "Delivered", never "Read".
  const first = miraLog.getByTestId('message').filter({ hasText: 'Hi Arjun!' });
  await expect(first).toContainText('Delivered');
  await mira.page.waitForTimeout(500);
  await expect(first).not.toContainText('Read');
  // Both turn "Share read receipts" on (reciprocal); Mira's message now shows "Read".
  for (const [who, other] of /** @type {const} */ ([
    [arjun, 'Mira'],
    [mira, 'Arjun'],
  ])) {
    await who.page.getByRole('link', { name: 'Settings', exact: true }).click();
    const toggle = who.page.getByRole('checkbox', { name: 'Share read receipts' });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();
    await openChat(who.page, other);
  }
  await expect(first).toContainText('Read');

  // Arjun answers with the button.
  await arjun.page.getByRole('textbox', { name: 'Message' }).fill('Hello Mira');
  await arjun.page.getByRole('button', { name: 'Send' }).click();
  await expect(miraLog.getByText('Hello Mira')).toBeVisible();
  expect(await seriousViolations(arjun.page)).toEqual([]);
  await mira.page.screenshot({ path: new URL('phase13-web-chat.png', SHOTS).pathname });

  // Arjun goes offline; Mira sends three messages; Arjun gets them on return, in order, once.
  await arjun.context.setOffline(true);
  for (const text of ['one', 'two', 'three']) {
    await composer.fill(text);
    await composer.press('Enter');
  }
  await expect(miraLog.getByTestId('message').filter({ hasText: 'three' })).toContainText(
    /Sent|Delivered/,
  );
  await arjun.context.setOffline(false);
  await expect(arjunLog.getByText('three', { exact: true })).toBeVisible({ timeout: 30_000 });
  const texts = await arjunLog.getByTestId('message').allTextContents();
  expect(
    texts.filter((x) => x.includes('one') || x.includes('two') || x.includes('three')),
  ).toEqual([
    expect.stringContaining('one'),
    expect.stringContaining('two'),
    expect.stringContaining('three'),
  ]);

  // Mira writes while she is offline: it waits as "Sending" and goes out once she is back.
  await mira.context.setOffline(true);
  await composer.fill('queued while offline');
  await composer.press('Enter');
  await expect(
    miraLog.getByTestId('message').filter({ hasText: 'queued while offline' }),
  ).toContainText('Sending');
  await mira.context.setOffline(false);
  await expect(arjunLog.getByText('queued while offline')).toBeVisible({ timeout: 30_000 });
  await expect(arjunLog.getByText('queued while offline')).toHaveCount(1);

  // The chat list shows the last message and no unread count for the reader.
  await arjun.page.getByRole('link', { name: 'Chats', exact: true }).click();
  await expect(arjun.page.getByRole('list').getByRole('button', { name: 'Mira' })).toContainText(
    'queued while offline',
  );
  expect(await seriousViolations(arjun.page)).toEqual([]);
  await mira.context.close();
  await arjun.context.close();
});

test('a block closes the chat for both, and the blocked person is not told who blocked', async ({
  browser,
}) => {
  const { a: nila, b: rohan } = await matchedPair(browser, {
    woman: 'Nila',
    man: 'Rohan',
    colorScheme: 'dark',
  });
  await openChat(nila.page, 'Rohan');
  const rohanLog = await openChat(rohan.page, 'Nila');
  await rohan.page.getByRole('textbox', { name: 'Message' }).fill('hey');
  await rohan.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(rohanLog.getByTestId('message')).toContainText('hey');

  await nila.page.getByRole('button', { name: 'Block', exact: true }).click();
  const dialog = nila.page.getByRole('dialog', { name: 'Block Rohan?' });
  await dialog.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(nila.page).toHaveURL(/\/chats$/);
  // Rohan sees the same ended state an unmatch shows, and cannot write any more.
  await expect(rohan.page.getByRole('status')).toHaveText('This conversation has ended.');
  await expect(rohan.page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);

  // Nila's settings list Rohan as blocked; unblocking removes him from the list.
  await nila.page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(nila.page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(await seriousViolations(nila.page)).toEqual([]);
  await nila.page.screenshot({
    path: new URL('phase13-web-settings-dark.png', SHOTS).pathname,
    fullPage: true,
  });
  await nila.page.getByRole('button', { name: 'Unblock Rohan' }).click();
  await expect(nila.page.getByText('You have not blocked anyone.')).toBeVisible();
  await nila.context.close();
  await rohan.context.close();
});

test('settings: notification preferences and quiet hours are saved; safety centre and privacy pages', async ({
  browser,
}) => {
  const { a: tara, b: dev } = await matchedPair(browser, { woman: 'Tara', man: 'Devan' });
  await dev.context.close();
  const page = tara.page;
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'New messages' }).uncheck();
  await page.getByRole('checkbox', { name: 'Quiet hours' }).check();
  await page.getByLabel('From').fill('22:30');
  await page.getByLabel('Until').fill('07:15');
  await page.getByRole('textbox', { name: 'Time zone' }).fill('Asia/Kolkata');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'New messages' })).not.toBeChecked();
  await expect(page.getByLabel('From')).toHaveValue('22:30');
  await expect(page.getByRole('textbox', { name: 'Time zone' })).toHaveValue('Asia/Kolkata');

  await page.getByRole('link', { name: 'Safety centre' }).click();
  await expect(page.getByRole('heading', { name: 'Staying safe on Vouch' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto('/settings/privacy');
  await expect(page.getByRole('heading', { name: 'Grievance officer' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await tara.context.close();
});

test('a conversation with 1,000 messages stays virtualised and responsive', async ({ browser }) => {
  const { a: leela, b: kiran } = await matchedPair(browser, { woman: 'Leela', man: 'Kiran' });
  const log = await openChat(leela.page, 'Kiran');
  // Kiran's second device sends 1,000 messages over the socket.
  const socket = await secondDevice(kiran.email);
  const conversationId = /** @type {string} */ (leela.page.url().split('/').at(-1));
  for (let i = 1; i <= 1000; i += 1) {
    const ack = await socket.timeout(10_000).emitWithAck('message.send', {
      conversationId,
      clientMsgId: crypto.randomUUID(),
      kind: 'text',
      body: `bulk ${i}`,
    });
    expect(ack.ok).toBe(true);
  }
  socket.disconnect();
  await expect(log.getByText('bulk 1000', { exact: true })).toBeVisible({ timeout: 30_000 });
  // Only a window of rows is in the DOM.
  const rendered = await log.getByTestId('message').count();
  expect(rendered).toBeLessThan(80);
  // Reload: the newest page opens; older pages load on demand, still windowed.
  await leela.page.reload();
  await expect(log.getByText('bulk 1000', { exact: true })).toBeVisible();
  for (let i = 0; i < 5; i += 1)
    await leela.page.getByRole('button', { name: 'Load earlier messages' }).click();
  // Scrolling through the loaded history stays fast: one long frame budget per scroll step.
  const ms = await log.evaluate(async (el) => {
    const started = performance.now();
    for (let y = el.scrollHeight; y > 0; y -= 600) {
      el.scrollTop = y;
      await new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve(undefined)));
    }
    return (performance.now() - started) / Math.max(1, Math.ceil(el.scrollHeight / 600));
  });
  process.stdout.write(
    `PHASE13_VIRTUAL ${JSON.stringify({ messages: 1000, renderedRows: rendered, msPerScrollStep: Math.round(ms * 10) / 10 })}\n`,
  );
  expect(ms).toBeLessThan(50);
  expect(await log.getByTestId('message').count()).toBeLessThan(80);
  await leela.context.close();
  await kiran.context.close();
});
