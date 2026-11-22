// @ts-check
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importJWK, SignJWT } from 'jose';
import postgres from 'postgres';
import { loadConfig } from '../src/platform/config.js';

/**
 * Deck latency benchmark (roadmap Phase 7): `pnpm --filter @vouch/api bench:deck`.
 * Against a running API (`ROLE=all`) with the 2,000-user seed, it signs access tokens for
 * seeded users with the local development key, waits until each has a deck, then sends
 * `--requests` `GET /v1/deck` calls (`--concurrency` at a time) and prints latency
 * percentiles. Development only: refuses NODE_ENV=production and needs a private signing key.
 *
 * Each simulated user sends its own `X-Forwarded-For` address, as real clients behind the CDN
 * would; otherwise the global per-IP rate limit (300/min) throttles the run from one machine.
 */

/** @param {number[]} sorted @param {number} p */
const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: 'http://localhost:3000' },
      requests: { type: 'string', default: '1000' },
      concurrency: { type: 'string', default: '10' },
      users: { type: 'string', default: '50' },
    },
  });
  const config = loadConfig(process.env);
  if (config.NODE_ENV === 'production') throw new Error('bench:deck is for local use only');
  const key = config.jwtKeys.find((k) => k.kid === config.JWT_ACTIVE_KID);
  if (!key?.privateJwk) throw new Error('run `pnpm dev:keys --write` first (no private key)');
  const privateKey = await importJWK(/** @type {any} */ (key.privateJwk), 'EdDSA');
  const total = Number(values.requests);
  const concurrency = Number(values.concurrency);

  const sql = postgres(config.DATABASE_URL, { max: 1 });
  const users = await sql`SELECT user_id AS id FROM profiles.profiles WHERE status = 'active'
    ORDER BY user_id LIMIT ${Number(values.users)}`;
  await sql.end();
  if (users.length === 0) throw new Error('no active profiles: run `pnpm db:seed`');

  /** @param {string} userId */
  const token = (userId) =>
    new SignJWT({ sid: randomUUID() })
      .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
      .setIssuer('vouch')
      .setAudience('vouch:user')
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);
  const tokens = await Promise.all(users.map((u) => token(u.id)));
  /** @param {string} bearer */
  const get = async (bearer) => {
    const client = tokens.indexOf(bearer);
    const started = performance.now();
    const response = await fetch(`${values.url}/v1/deck`, {
      headers: {
        authorization: `Bearer ${bearer}`,
        'x-app-version': '1.0.0',
        'x-forwarded-for': `10.77.${Math.floor(client / 250)}.${(client % 250) + 1}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    const body = /** @type {{ cards?: unknown[] }} */ (await response.json());
    return {
      ms: performance.now() - started,
      status: response.status,
      cards: body.cards?.length ?? 0,
    };
  };

  // Warm-up: the first request queues each deck build; wait until every user gets cards.
  for (const bearer of tokens) {
    for (let attempt = 0; attempt < 100 && (await get(bearer)).cards === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** @type {{ ms: number, status: number, cards: number }[]} */
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < total) {
      const i = next++;
      results.push(await get(/** @type {string} */ (tokens[i % tokens.length])));
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const seconds = (performance.now() - started) / 1000;
  const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
  const round = (/** @type {number} */ x) => Math.round(x * 10) / 10;
  process.stdout.write(
    `${JSON.stringify(
      {
        requests: results.length,
        concurrency,
        users: tokens.length,
        nonOk: results.filter((r) => r.status !== 200).length,
        fullPages: results.filter((r) => r.cards === 10).length,
        emptyPages: results.filter((r) => r.cards === 0).length,
        throughputPerSecond: round(results.length / seconds),
        ms: {
          p50: round(percentile(sorted, 0.5)),
          p95: round(percentile(sorted, 0.95)),
          p99: round(percentile(sorted, 0.99)),
          max: round(sorted.at(-1) ?? 0),
        },
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(
      `bench:deck failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
