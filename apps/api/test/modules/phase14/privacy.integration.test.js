// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOOK_TIMEOUT_MS } from '../../platform/helpers.js';
import { startBackend } from '../phase10/harness.js';

/**
 * Phase 14 privacy (DPDP): the data export covers every module that holds the user's data,
 * the consent records the notice version, and the export never reveals other people's reports.
 */
describe('privacy: export completeness and consent (Phase 14)', () => {
  /** @type {Awaited<ReturnType<typeof startBackend>>} */
  let b;
  beforeAll(async () => {
    b = await startBackend();
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await b?.stop();
  }, HOOK_TIMEOUT_MS);

  it('every module that erases data on deletion also exports it', async () => {
    const user = await b.signUp();
    const exported = await b.call('GET', '/v1/me/export', { token: user.token });
    expect(exported.status).toBe(200);
    const erasing = b.app.boot.subscriptions.get('user.deleted.v1') ?? [];
    expect([...erasing].sort()).toEqual(
      ['chat', 'matching', 'media', 'notifications', 'profiles', 'safety'].sort(),
    );
    for (const module of ['identity', ...erasing]) {
      expect(Object.keys(exported.body.data)).toContain(module);
    }
    // The consent the student gave, with the notice version they were shown.
    const [{ notice_version: version }] = await b.infra
      .admin`SELECT notice_version FROM identity.consents WHERE user_id = ${user.id}`;
    expect(version).toBe('2026-11-draft');
    expect(exported.body.data.identity.consents[0].noticeVersion).toBe('2026-11-draft');
  });

  it("safety exports the user's own blocks and reports, never reports about them", async () => {
    const [me, other, reporter] = [await b.signUp(), await b.signUp(), await b.signUp()];
    await b.call('POST', '/v1/blocks', { token: me.token, body: { targetId: other.publicId } });
    const mine = await b.call('POST', '/v1/reports', {
      token: me.token,
      body: { targetId: reporter.publicId, context: 'profile', reason: 'spam' },
    });
    expect(mine.status).toBe(201);
    const aboutMe = await b.call('POST', '/v1/reports', {
      token: reporter.token,
      body: { targetId: me.publicId, context: 'profile', reason: 'harassment' },
    });
    expect(aboutMe.status).toBe(201);

    const exported = await b.call('GET', '/v1/me/export', { token: me.token });
    const safety = exported.body.data.safety;
    expect(safety.blocks.map((/** @type {any} */ x) => x.userId)).toEqual([other.publicId]);
    expect(safety.reportsFiled).toEqual([
      expect.objectContaining({ aboutUserId: reporter.publicId, reason: 'spam', status: 'open' }),
    ]);
    expect(JSON.stringify(exported.body)).not.toContain('harassment');
    expect(safety.verification).toEqual([]);
  });
});
