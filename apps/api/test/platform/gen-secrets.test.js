// @ts-check
import { importJWK, SignJWT, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { generateSecrets } from '../../../../scripts/gen-secrets.js';
import { loadConfig } from '../../src/platform/config.js';
import { testEnv } from './helpers.js';

describe('gen-secrets (Phase 15)', () => {
  it('produces values the environment schema accepts, and a working signing key', async () => {
    const secrets = generateSecrets('staging');
    const config = loadConfig(
      testEnv({
        DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
        REDIS_URL: 'redis://127.0.0.1:1',
        ...secrets,
      }),
    );
    expect(config.JWT_ACTIVE_KID).toMatch(/^staging-/);
    const [key] = JSON.parse(secrets.JWT_SIGNING_KEYS);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
      .sign(await importJWK(key.privateJwk, 'EdDSA'));
    await expect(jwtVerify(token, await importJWK(key.publicJwk, 'EdDSA'))).resolves.toBeTruthy();
  });

  it('never repeats a value', () => {
    const [a, b] = [generateSecrets('production'), generateSecrets('production')];
    for (const name of Object.keys(a)) {
      expect(new Map(Object.entries(a)).get(name)).not.toBe(new Map(Object.entries(b)).get(name));
    }
  });
});
