// @ts-check
/**
 * Prepares the Phase 14 load test (`load/README.md`). Development and load environments only.
 *
 * - Seeds the 2,000 synthetic users (the same seed as the tests).
 * - Opens `--pairs` conversations between seeded users (match + conversation rows, as the
 *   match consumer would), for the chat senders.
 * - Signs one access token per user with the load environment's private key, valid for
 *   `--hours`.
 * - Writes `load/out/users.json` (`[{ id, publicId, token }]`) and `load/out/pairs.json`
 *   (`[{ conversationId, a, b }]`, indexes into users), read by the k6 scripts.
 *
 * Usage: DATABASE_URL=… JWT_SIGNING_KEYS=… JWT_ACTIVE_KID=… node scripts/load-prepare.js
 *          [--pairs 500] [--hours 3]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importJWK, SignJWT } from 'jose';
import postgres from 'postgres';
import { createIdGenerator } from '../src/platform/ids.js';
import { seed } from './seed.js';

const OUT = fileURLToPath(new URL('../../../load/out/', import.meta.url));

async function main() {
  const { values } = parseArgs({
    options: { pairs: { type: 'string', default: '500' }, hours: { type: 'string', default: '3' } },
  });
  const env = process.env;
  if (!env.DATABASE_URL || !env.JWT_SIGNING_KEYS || !env.JWT_ACTIVE_KID) {
    throw new Error('DATABASE_URL, JWT_SIGNING_KEYS and JWT_ACTIVE_KID are required');
  }
  // The load stack runs NODE_ENV=production on purpose; DEPLOY_ENV names a real deployment.
  if (env.DEPLOY_ENV === 'production' || env.DEPLOY_ENV === 'staging') {
    throw new Error('never run the load preparation against a deployed environment');
  }
  const key = JSON.parse(env.JWT_SIGNING_KEYS).find(
    (/** @type {any} */ k) => k.kid === env.JWT_ACTIVE_KID,
  );
  if (!key?.privateJwk) throw new Error('the active key has no private part');
  const privateKey = await importJWK(key.privateJwk, 'EdDSA');
  const sql = postgres(env.DATABASE_URL, { max: 4, onnotice: () => {} });
  const newId = createIdGenerator({ clock: { now: () => new Date() } });

  try {
    await seed(sql);
    const users = await sql`SELECT u.id, u.public_id FROM identity.users u
      JOIN profiles.profiles p ON p.user_id = u.id WHERE p.status = 'active' ORDER BY u.id`;
    const pairCount = Math.min(Number(values.pairs), Math.floor(users.length / 2));
    // Pairs from the end of the list, so the first users stay free to swipe.
    /** @type {{ conversationId: string, a: number, b: number }[]} */
    const pairs = [];
    await sql.begin(async (tx) => {
      for (let i = 0; i < pairCount; i += 1) {
        const [a, b] = [users.length - 1 - 2 * i, users.length - 2 - 2 * i];
        const [low, high] = [users.at(a)?.id, users.at(b)?.id].sort();
        const id = newId();
        await tx`INSERT INTO matching.matches (id, user_low, user_high) VALUES (${id}, ${low}, ${high})
          ON CONFLICT DO NOTHING`;
        const [match] = await tx`SELECT id FROM matching.matches
          WHERE user_low = ${low} AND user_high = ${high}`;
        await tx`INSERT INTO chat.conversations (id, match_id, user_low, user_high)
          VALUES (${match.id}, ${match.id}, ${low}, ${high}) ON CONFLICT DO NOTHING`;
        for (const userId of [low, high]) {
          await tx`INSERT INTO chat.read_cursors (conversation_id, user_id)
            VALUES (${match.id}, ${userId}) ON CONFLICT DO NOTHING`;
        }
        pairs.push({ conversationId: match.id, a, b });
      }
    });

    const now = Math.floor(Date.now() / 1000);
    const exp = now + Number(values.hours) * 3600;
    const tokens = await Promise.all(
      users.map((u) =>
        new SignJWT({ sid: newId() })
          .setProtectedHeader({ alg: 'EdDSA', kid: env.JWT_ACTIVE_KID, typ: 'JWT' })
          .setIssuer('vouch')
          .setAudience('vouch:user')
          .setSubject(u.id)
          .setIssuedAt(now)
          .setExpirationTime(exp)
          .sign(privateKey),
      ),
    );
    // Fixed paths under load/out (git-ignored).
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(OUT, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(
      `${OUT}users.json`,
      JSON.stringify(
        users.map((u, i) => ({ id: u.id, publicId: u.public_id, token: tokens.at(i) })),
      ),
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(`${OUT}pairs.json`, JSON.stringify(pairs));
    process.stdout.write(`prepared ${users.length} users and ${pairs.length} conversations\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
