// @ts-check
import { describe, expect, it } from 'vitest';
import {
  generateKey,
  readEnvVar,
  rotateKeys,
  updateEnvText,
} from '../../../../scripts/dev-keys.js';
import { createTokenIssuer } from '../../src/modules/identity/adapters/tokens/jose-issuer.js';
import { createTokenVerifier } from '../../src/platform/auth.js';
import { systemClock } from '../../src/platform/clock.js';
import { loadConfig } from '../../src/platform/config.js';
import { testEnv } from '../platform/helpers.js';

describe('scripts/dev-keys.js', () => {
  it('generates an Ed25519 key that config accepts and that signs verifiable tokens', async () => {
    const key = generateKey(new Date('2026-11-21T00:00:00Z'));
    expect(key.kid).toMatch(/^dev-20261121-[0-9a-f]{6}$/);
    expect(key.publicJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    expect(key.privateJwk).toHaveProperty('d');

    const config = loadConfig(
      testEnv({ JWT_SIGNING_KEYS: JSON.stringify([key]), JWT_ACTIVE_KID: key.kid }),
    );
    const issuer = await createTokenIssuer({
      keys: config.jwtKeys,
      activeKid: key.kid,
      clock: systemClock,
    });
    const verifier = await createTokenVerifier({ keys: config.jwtKeys, clock: systemClock });
    const { token } = await issuer.issueAccessToken({ userId: 'u1', sessionId: 's1' });
    expect(await verifier.verify(token, 'vouch:user')).toMatchObject({
      userId: 'u1',
      sessionId: 's1',
    });
  });

  it('rotation adds a new active key and retires the old one without its private half', () => {
    const first = generateKey(new Date());
    const now = new Date('2026-11-21T12:00:00Z');
    const { keys, activeKid } = rotateKeys([first], first.kid, now);
    expect(keys).toHaveLength(2);
    expect(activeKid).not.toBe(first.kid);
    expect(keys[0]).toEqual({
      kid: first.kid,
      publicJwk: first.publicJwk,
      retiredAt: now.toISOString(),
    });
    expect(keys[1]?.privateJwk).toBeDefined();
  });

  it('updates .env text in place, appending missing variables', () => {
    const text = 'A=1\nJWT_ACTIVE_KID=old\nB=2\n';
    const updated = updateEnvText(text, { JWT_ACTIVE_KID: 'new', JWT_SIGNING_KEYS: '[]' });
    expect(updated).toBe('A=1\nJWT_ACTIVE_KID=new\nB=2\nJWT_SIGNING_KEYS=[]\n');
    expect(readEnvVar(updated, 'JWT_ACTIVE_KID')).toBe('new');
    expect(readEnvVar(updated, 'MISSING')).toBeUndefined();
  });

  it('refuses to issue tokens when the active key has no private half', async () => {
    const key = generateKey(new Date());
    const { privateJwk: _drop, ...publicOnly } = key;
    const config = loadConfig(
      testEnv({ JWT_SIGNING_KEYS: JSON.stringify([publicOnly]), JWT_ACTIVE_KID: key.kid }),
    );
    await expect(
      createTokenIssuer({ keys: config.jwtKeys, activeKid: key.kid, clock: systemClock }),
    ).rejects.toThrow(/pnpm dev:keys/);
  });
});
