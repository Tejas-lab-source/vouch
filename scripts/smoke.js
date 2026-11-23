// @ts-check
/**
 * The production smoke suite (Phase 15): read-only checks against a deployed environment. It
 * creates no data and sends no email, so it is safe on production. The deploy workflow runs it
 * on staging before promotion and on production after.
 *
 *   node scripts/smoke.js --api https://api.example.app \
 *     [--web https://app.example.app] [--admin https://admin.example.app]
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const H = { 'x-app-version': '1.0.0' };

/**
 * @param {{ api: string, web?: string, admin?: string, fetch?: typeof fetch }} options
 * @returns {Promise<{ name: string, ok: boolean, detail: string }[]>}
 */
export async function runSmoke({ api, web, admin, fetch: fetchImpl = fetch }) {
  /** @type {{ name: string, ok: boolean, detail: string }[]} */
  const results = [];
  /** @param {string} name @param {() => Promise<string | true>} check */
  const check = async (name, check) => {
    try {
      const outcome = await check();
      results.push({ name, ok: outcome === true, detail: outcome === true ? 'ok' : outcome });
    } catch (error) {
      results.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  /** @param {string} path @param {RequestInit} [init] */
  const call = (path, init = {}) =>
    fetchImpl(`${api}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });

  await check('GET /health is ok', async () => {
    const r = await call('/health');
    const body = /** @type {any} */ (await r.json());
    return r.status === 200 && body.status === 'ok' ? true : `${r.status} ${JSON.stringify(body)}`;
  });
  await check('GET /ready: Postgres, Redis and migrations', async () => {
    const r = await call('/ready');
    const body = /** @type {any} */ (await r.json());
    return r.status === 200 && body.status === 'ready'
      ? true
      : `${r.status} ${JSON.stringify(body)}`;
  });
  await check('GET /v1/config answers', async () => {
    const r = await call('/v1/config');
    return r.status === 200 ? true : `${r.status}`;
  });
  await check('a protected route refuses an anonymous caller', async () => {
    const r = await call('/v1/deck');
    const body = /** @type {any} */ (await r.json());
    return r.status === 401 && body.error?.code === 'UNAUTHENTICATED'
      ? true
      : `${r.status} ${body.error?.code}`;
  });
  await check('sign-in validates input before anything is sent', async () => {
    const r = await call('/v1/auth/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `smoke-${Date.now()}` },
      body: JSON.stringify({ email: 'not-an-email', turnstileToken: 'smoke' }),
    });
    const body = /** @type {any} */ (await r.json());
    return r.status === 400 && body.error?.code === 'VALIDATION_FAILED'
      ? true
      : `${r.status} ${body.error?.code}`;
  });
  await check('metrics are not public', async () => {
    const [internal, plain] = await Promise.all([call('/internal/metrics'), call('/metrics')]);
    return internal.status === 404 && plain.status === 404
      ? true
      : `/internal/metrics ${internal.status}, /metrics ${plain.status}`;
  });
  await check('security headers on API responses', async () => {
    const r = await call('/health');
    const missing = ['strict-transport-security', 'x-content-type-options'].filter(
      (h) => !r.headers.get(h),
    );
    return missing.length === 0 ? true : `missing ${missing.join(', ')}`;
  });
  await check('CORS refuses an unknown origin', async () => {
    const r = await call('/v1/config', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    const allowed = r.headers.get('access-control-allow-origin');
    return !allowed || allowed === 'null' ? true : `allowed ${allowed}`;
  });

  for (const [name, origin] of /** @type {const} */ ([
    ['web', web],
    ['admin', admin],
  ])) {
    if (!origin) continue;
    const site = new URL(origin).origin;
    await check(`CORS allows the ${name} app with credentials`, async () => {
      const r = await call('/v1/me/profile', {
        method: 'OPTIONS',
        headers: {
          origin: site,
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'authorization,content-type,idempotency-key',
        },
      });
      const methods = (r.headers.get('access-control-allow-methods') ?? '').split(/,\s*/);
      if (!['PUT', 'PATCH', 'DELETE'].every((m) => methods.includes(m))) {
        return `allow-methods ${methods.join(',')}`;
      }
      return r.headers.get('access-control-allow-origin') === site &&
        r.headers.get('access-control-allow-credentials') === 'true'
        ? true
        : `allow-origin ${r.headers.get('access-control-allow-origin')}`;
    });
    await check(`the ${name} app loads with its CSP`, async () => {
      const r = await fetchImpl(origin);
      const csp = r.headers.get('content-security-policy') ?? '';
      if (r.status !== 200) return `${r.status}`;
      if (!(await r.text()).includes('<div id="root">')) return 'no app shell';
      return csp.includes(new URL(api).origin) ? true : 'CSP does not name the API';
    });
    if (name === 'admin') {
      await check('the admin app is not indexed', async () => {
        const r = await fetchImpl(origin);
        return (r.headers.get('x-robots-tag') ?? '').includes('noindex') ? true : 'no X-Robots-Tag';
      });
    }
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { api: { type: 'string' }, web: { type: 'string' }, admin: { type: 'string' } },
  });
  if (!values.api) {
    process.stderr.write(
      'usage: node scripts/smoke.js --api <url> [--web <url>] [--admin <url>]\n',
    );
    process.exitCode = 1;
  } else {
    const results = await runSmoke({ ...values, api: values.api.replace(/\/+$/, '') });
    for (const r of results)
      process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `: ${r.detail}`}\n`);
    const failed = results.filter((r) => !r.ok).length;
    process.stdout.write(`${results.length - failed}/${results.length} passed\n`);
    if (failed > 0) process.exitCode = 1;
  }
}
