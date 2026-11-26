// @ts-check
import { importJWK, SignJWT, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { generateSecrets, rotateJwt } from '../../../../scripts/gen-secrets.js';
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

  it('rotate-jwt retires the active key (public half only), adds a new one and prunes old ones', () => {
    const first = generateSecrets('production');
    const t0 = new Date('2026-12-01T00:00:00Z');
    const once = rotateJwt('production', first.JWT_SIGNING_KEYS, first.JWT_ACTIVE_KID, t0);
    const keys = JSON.parse(once.JWT_SIGNING_KEYS);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual({
      kid: first.JWT_ACTIVE_KID,
      publicJwk: expect.any(Object),
      retiredAt: t0.toISOString(),
    });
    expect(once.JWT_ACTIVE_KID).toMatch(/^production-/);
    expect(keys[1].kid).toBe(once.JWT_ACTIVE_KID);
    // The result loads: the retired key still verifies during the grace window.
    loadConfig(
      testEnv({
        DATABASE_URL: 'postgres://u@127.0.0.1:1/u',
        REDIS_URL: 'redis://127.0.0.1:1',
        ...first,
        ...once,
      }),
    );
    // Two days later the first key is dropped.
    const later = new Date(t0.getTime() + 2 * 864e5);
    const twice = rotateJwt('production', once.JWT_SIGNING_KEYS, once.JWT_ACTIVE_KID, later);
    const kids = JSON.parse(twice.JWT_SIGNING_KEYS).map((/** @type {any} */ k) => k.kid);
    expect(kids).not.toContain(first.JWT_ACTIVE_KID);
    expect(kids).toContain(once.JWT_ACTIVE_KID);
    expect(() => rotateJwt('production', first.JWT_SIGNING_KEYS, 'nope')).toThrow(/active kid/);
  });
});
