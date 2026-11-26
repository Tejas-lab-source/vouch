// @ts-check
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { createIdentityCrypto } from '../src/modules/identity/adapters/crypto/node-crypto.js';
import { createIdentityStores } from '../src/modules/identity/adapters/pg/stores.js';
import { formatInviteCode, normaliseInviteCode } from '../src/modules/identity/domain/invite.js';
import { systemClock as clock } from '../src/platform/clock.js';
import { createIdGenerator } from '../src/platform/ids.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Creates invite codes for one college (Phase 15). Only SHA-256 hashes are stored; the codes
 * are printed once, to hand out (for example one per tester). Run in the Render shell:
 *
 *   node scripts/invite-create.js --college <college id or email domain> --count 50 \
 *     [--uses 1] [--expires-days 30] [--label "batch 1"]
 *
 * `--uses 0` makes a code reusable without limit (for a group link); `--expires-days 0` never
 * expires. Labels name a batch, never a person.
 * @param {{
 *   sql: import('postgres').Sql,
 *   newId: () => string,
 *   college: string,
 *   count: number,
 *   uses: number,
 *   expiresDays: number,
 *   label: string,
 *   now: Date,
 *   random?: (n: number) => Uint8Array,
 * }} input
 * @returns {Promise<{ collegeId: string, collegeName: string, codes: string[], expiresAt: Date | null }>}
 */
export async function createInvites({
  sql,
  newId,
  college,
  count,
  uses,
  expiresDays,
  label,
  now,
  random = (n) => randomBytes(n),
}) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('--count: 1 to 1000');
  if (!Number.isInteger(uses) || uses < 0) throw new Error('--uses: 0 (unlimited) or more');
  if (!Number.isInteger(expiresDays) || expiresDays < 0)
    throw new Error('--expires-days: 0 or more');
  if (label.length < 1 || label.length > 100) throw new Error('--label: 1 to 100 characters');
  const crypto = createIdentityCrypto({ emailHmacSecret: 'unused-for-invite-hashing-only' });
  const expiresAt = expiresDays > 0 ? new Date(now.getTime() + expiresDays * DAY_MS) : null;

  return sql.begin(async (tx) => {
    const byId = /^[0-9a-f-]{36}$/i.test(college);
    const [found] = byId
      ? await tx`SELECT id, name FROM platform.colleges WHERE id = ${college} AND active`
      : await tx`SELECT id, name FROM platform.colleges
          WHERE active AND ${college.toLowerCase()} = ANY(email_domains)`;
    if (!found) throw new Error(`no active college for ${college}`);
    const stores = createIdentityStores(/** @type {any} */ (tx));
    const codes = [];
    for (let i = 0; i < count; i += 1) {
      const code = formatInviteCode(random(16));
      await stores.inviteCodes.insert({
        id: newId(),
        codeHash: crypto.hashToken(/** @type {string} */ (normaliseInviteCode(code))),
        collegeId: found.id,
        label,
        maxUses: uses === 0 ? null : uses,
        expiresAt,
        at: now,
      });
      codes.push(code);
    }
    return { collegeId: found.id, collegeName: found.name, codes, expiresAt };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      college: { type: 'string' },
      count: { type: 'string', default: '1' },
      uses: { type: 'string', default: '1' },
      'expires-days': { type: 'string', default: '30' },
      label: { type: 'string', default: 'beta' },
    },
  });
  if (!values.college) {
    throw new Error(
      'usage: node scripts/invite-create.js --college <id or email domain> [--count 1] ' +
        '[--uses 1] [--expires-days 30] [--label beta]',
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const result = await createInvites({
      sql,
      newId: createIdGenerator({ clock }),
      college: values.college,
      count: Number(values.count),
      uses: Number(values.uses),
      expiresDays: Number(values['expires-days']),
      label: values.label,
      now: clock.now(),
    });
    process.stdout.write(
      `# ${result.codes.length} invite code(s) for ${result.collegeName}, ` +
        `${result.expiresAt ? `valid until ${result.expiresAt.toISOString().slice(0, 10)}` : 'no expiry'}.\n` +
        '# Shown once; only hashes are stored.\n' +
        `${result.codes.join('\n')}\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `invite-create failed: ${error instanceof Error ? error.message : error}\n`,
    );
    process.exitCode = 1;
  });
}
