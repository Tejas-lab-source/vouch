// @ts-check
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createAdminCrypto } from '../src/modules/admin/adapters/crypto/node-crypto.js';
import { createAdminStores } from '../src/modules/admin/adapters/pg/stores.js';
import { otpauthUri } from '../src/modules/admin/domain/totp.js';
import { systemClock as clock } from '../src/platform/clock.js';
import { loadConfig } from '../src/platform/config.js';
import { createDatabase } from '../src/platform/db.js';
import { createIdGenerator } from '../src/platform/ids.js';

/**
 * Creates one moderator or admin account (ADR 0018). This script is the only way to create
 * staff accounts: there is no sign-up route. It stores the email as an HMAC, the password as a
 * scrypt hash and a new TOTP secret encrypted with ADMIN_TOTP_KEY, and prints the password (if
 * generated) and the otpauth:// URI exactly once, for the new staff member to scan.
 * @param {{ db: import('../src/platform/db.js').Database, crypto: import('../src/modules/admin/adapters/crypto/node-crypto.js').AdminCrypto, newId: () => string, email: string, name: string, role: 'moderator' | 'admin', password: string, now: Date }} input
 */
export async function createAdminAccount({ db, crypto, newId, email, name, role, password, now }) {
  if (password.length < 12) throw new Error('the password must have at least 12 characters');
  const emailHmac = crypto.hmacEmail(email);
  const secret = crypto.newTotpSecret();
  const id = newId();
  await db.transaction('admin', async (tx) => {
    const stores = createAdminStores(tx);
    if (await stores.staff.findByEmailHmac(emailHmac)) {
      throw new Error('an account with this email already exists');
    }
    await stores.staff.insert({
      id,
      emailHmac,
      displayName: name,
      role,
      passwordHash: await crypto.hashPassword(password),
      totpSecretEnc: crypto.encryptSecret(secret),
      mfaEnabledAt: now,
    });
  });
  return { id, secret, uri: otpauthUri({ secret, account: name }) };
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: 'moderator' },
    },
  });
  if (!values.email || !values.name || !['moderator', 'admin'].includes(String(values.role))) {
    throw new Error(
      'usage: pnpm admin:create --email <email> --name <display name> --role moderator|admin',
    );
  }
  const config = loadConfig(process.env);
  if (!config.ADMIN_TOTP_KEY)
    throw new Error('ADMIN_TOTP_KEY is not set (run pnpm dev:keys --write)');
  const crypto = createAdminCrypto({
    totpKey: Buffer.from(config.ADMIN_TOTP_KEY, 'base64'),
    emailHmacSecret: config.EMAIL_HMAC_SECRET,
  });
  // A password from the environment (never a command-line flag, which lands in shell history),
  // or a generated one, printed once.
  const given = process.env.ADMIN_CREATE_PASSWORD;
  const password = given ?? randomBytes(18).toString('base64url');
  const db = createDatabase({ url: config.DATABASE_URL, max: 1 });
  try {
    const { uri } = await createAdminAccount({
      db,
      crypto,
      newId: createIdGenerator({ clock }),
      email: values.email,
      name: values.name,
      role: /** @type {'moderator' | 'admin'} */ (values.role),
      password,
      now: clock.now(),
    });
    process.stdout.write(
      [
        `Created ${values.role} "${values.name}".`,
        given
          ? 'Password: the one in ADMIN_CREATE_PASSWORD.'
          : `Password (shown once): ${password}`,
        'Add the account to an authenticator app with this URI (shown once):',
        uri,
        '',
      ].join('\n'),
    );
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
