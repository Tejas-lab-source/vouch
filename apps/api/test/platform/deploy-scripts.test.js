// @ts-check
import { describe, expect, it } from 'vitest';
import { requestTotals, verdict, watchDeploy } from '../../../../scripts/deploy-watch.js';
import { createRenderClient } from '../../../../scripts/render-deploy.js';

/**
 * A fake Render API: deploy statuses advance one step per GET.
 * @param {Record<string, string[]>} timelines  deploy id → statuses
 */
function fakeRender(timelines) {
  /** @type {{ method: string, url: string, body: any, auth: string }[]} */
  const calls = [];
  const steps = new Map(Object.entries(timelines).map(([id, s]) => [id, [...s]]));
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = /** @type {Record<string, string>} */ (init.headers ?? {});
    calls.push({
      method,
      url,
      body: init.body ? JSON.parse(String(init.body)) : null,
      auth: headers.authorization ?? '',
    });
    /** @param {number} status @param {unknown} body */
    const reply = (status, body) => new Response(JSON.stringify(body), { status });
    if (url.endsWith('/deploys?limit=20')) {
      return reply(200, [
        { deploy: { id: 'dep-new', status: 'build_in_progress' }, cursor: 'a' },
        { deploy: { id: 'dep-old', status: 'live', commit: { id: 'c'.repeat(40) } }, cursor: 'b' },
      ]);
    }
    if (method === 'POST' && url.endsWith('/deploys'))
      return reply(201, { id: 'dep-1', status: 'created' });
    if (method === 'POST' && url.endsWith('/rollback'))
      return reply(201, { id: 'dep-rb', status: 'created' });
    const id = url.split('/').at(-1) ?? '';
    const queue = steps.get(id);
    if (!queue) return reply(404, { message: 'not found' });
    const status = queue.length > 1 ? queue.shift() : queue[0];
    return reply(200, { id, status });
  };
  return { calls, fetchImpl };
}

describe('Render deploys (scripts/render-deploy.js)', () => {
  const sleep = async () => {};

  it('deploys one exact commit, waits until live, and finds the live deploy for rollback', async () => {
    const fake = fakeRender({
      'dep-1': ['created', 'build_in_progress', 'pre_deploy_in_progress', 'live'],
    });
    const render = createRenderClient({ apiKey: 'rnd_key', fetch: fake.fetchImpl, sleep });
    expect(await render.current('srv-1')).toEqual({ id: 'dep-old', commit: 'c'.repeat(40) });
    const live = await render.deploy('srv-1', 'a'.repeat(40));
    expect(live).toMatchObject({ id: 'dep-1', status: 'live' });
    const post = fake.calls.find((c) => c.method === 'POST');
    expect(post).toMatchObject({
      url: 'https://api.render.com/v1/services/srv-1/deploys',
      body: { commitId: 'a'.repeat(40), clearCache: 'do_not_clear' },
      auth: 'Bearer rnd_key',
    });
  });

  it('fails on a failed pre-deploy (migrations) and refuses a short sha', async () => {
    const fake = fakeRender({ 'dep-1': ['created', 'pre_deploy_failed'] });
    const render = createRenderClient({ apiKey: 'k', fetch: fake.fetchImpl, sleep });
    await expect(render.deploy('srv-1', 'a'.repeat(40))).rejects.toThrow(/pre_deploy_failed/);
    await expect(render.deploy('srv-1', 'abc123')).rejects.toThrow(/40-character/);
  });

  it('rolls back to a given deploy and waits for it', async () => {
    const fake = fakeRender({ 'dep-rb': ['update_in_progress', 'live'] });
    const render = createRenderClient({ apiKey: 'k', fetch: fake.fetchImpl, sleep });
    expect((await render.rollback('srv-1', 'dep-old')).id).toBe('dep-rb');
    expect(fake.calls.find((c) => c.url.endsWith('/rollback'))?.body).toEqual({
      deployId: 'dep-old',
    });
  });

  it('API errors name the status but never the key', async () => {
    const render = createRenderClient({
      apiKey: 'rnd_secret_key',
      fetch: async () => new Response('{"message":"unauthorized"}', { status: 401 }),
      sleep,
    });
    const error = await render.current('srv-1').catch((e) => e);
    expect(error.message).toContain('401');
    expect(error.message).not.toContain('rnd_secret_key');
  });
});

/** @param {Record<string, number>} counts  "route status" → count */
const metricsText = (counts) =>
  Object.entries(counts)
    .map(([key, n]) => {
      const [route, status] = key.split(' ');
      return `http_request_duration_seconds_count{method="GET",route="${route}",status_code="${status}"} ${n}`;
    })
    .join('\n');

describe('post-deploy watch (scripts/deploy-watch.js)', () => {
  it('counts user routes only and computes the 5xx share over the window', () => {
    const start = requestTotals(metricsText({ '/v1/deck 200': 100, '/ready 503': 50 }));
    expect(start).toEqual({ total: 100, errors: 0 });
    const end = requestTotals(
      metricsText({ '/v1/deck 200': 290, '/v1/deck 500': 10, '/health 200': 9 }),
    );
    expect(verdict(start, end, 0.02)).toMatchObject({
      ok: false,
      total: 200,
      errors: 10,
      share: 0.05,
    });
    expect(
      verdict(start, requestTotals(metricsText({ '/v1/deck 200': 297, '/v1/deck 500': 3 })), 0.02)
        .ok,
    ).toBe(true);
    // Few requests: not enough to judge. A restart (counters reset) uses the end sample.
    expect(verdict({ total: 0, errors: 0 }, { total: 10, errors: 5 }, 0.02).ok).toBe(true);
    expect(verdict({ total: 1000, errors: 0 }, { total: 100, errors: 50 }, 0.02)).toMatchObject({
      ok: false,
      total: 100,
    });
  });

  it('stops early when /ready fails twice in a row', async () => {
    let scrapes = 0;
    /** @type {typeof fetch} */
    const fetchImpl = async (input) =>
      String(input).endsWith('/internal/metrics')
        ? (scrapes++, new Response(metricsText({ '/v1/deck 200': 1 })))
        : new Response('{}', { status: 503 });
    const result = await watchDeploy({
      api: 'https://api',
      token: 't',
      minutes: 10,
      maxError: 0.02,
      fetch: fetchImpl,
      sleep: async () => {},
    });
    expect(result).toEqual({ ok: false, reason: 'not ready for 2 minutes' });
    expect(scrapes).toBe(1);
  });

  it('passes a healthy window', async () => {
    let n = 0;
    /** @type {typeof fetch} */
    const fetchImpl = async (input) =>
      String(input).endsWith('/internal/metrics')
        ? new Response(metricsText({ '/v1/deck 200': (n += 500) }))
        : new Response('{}', { status: 200 });
    const result = await watchDeploy({
      api: 'https://api',
      token: 't',
      minutes: 3,
      maxError: 0.02,
      fetch: fetchImpl,
      sleep: async () => {},
    });
    expect(result).toMatchObject({ ok: true, total: 500, errors: 0 });
  });
});
