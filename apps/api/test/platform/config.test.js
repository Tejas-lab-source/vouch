// @ts-check
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/platform/config.js';
import { testEnv } from './helpers.js';

describe('loadConfig', () => {
  it('parses a valid environment with defaults', () => {
    const config = loadConfig(testEnv());
    expect(config).toMatchObject({
      ROLE: 'all',
      PORT: 3000,
      METRICS_PORT: 9464,
      SHUTDOWN_DRAIN_MS: 25000,
    });
    expect(config.jwtKeys).toHaveLength(1);
  });

  it('refuses to boot when variables are missing, naming them without values', () => {
    const env = testEnv();
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig({ ...env, EMAIL_HMAC_SECRET: 'too-short-secret' });
    } catch (err) {
      const message = /** @type {Error} */ (err).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('EMAIL_HMAC_SECRET');
      expect(message).not.toContain('too-short-secret');
    }
  });

  it('accepts a drain of 25 s by default and refuses one longer than the host kill', () => {
    expect(loadConfig(testEnv({ SHUTDOWN_DRAIN_MS: '10000' })).SHUTDOWN_DRAIN_MS).toBe(10000);
    expect(() => loadConfig(testEnv({ SHUTDOWN_DRAIN_MS: '30000' }))).toThrow(/SHUTDOWN_DRAIN_MS/);
  });

  it('rejects JWT_SIGNING_KEYS that are not JSON or not Ed25519 JWKs', () => {
    expect(() => loadConfig(testEnv({ JWT_SIGNING_KEYS: 'not json' }))).toThrow(/must be JSON/);
    expect(() =>
      loadConfig(
        testEnv({ JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'k', publicJwk: { kty: 'RSA' } }]) }),
      ),
    ).toThrow(/JWT_SIGNING_KEYS/);
  });

  it('requires the active kid to exist and not be retired', () => {
    expect(() => loadConfig(testEnv({ JWT_ACTIVE_KID: 'other' }))).toThrow(/no key with this kid/);
    const retired = JSON.stringify([
      {
        kid: 'test-1',
        publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'aGVsbG8' },
        retiredAt: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(() => loadConfig(testEnv({ JWT_SIGNING_KEYS: retired }))).toThrow(/retired/);
  });
});
