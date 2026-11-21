// @ts-check
import { EnvSchema } from '@vouch/contracts';
import { z } from 'zod';

/** Ed25519 public key as a JWK. */
const PublicJwk = z.looseObject({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string().min(1),
});

/** Ed25519 private key as a JWK (holds `d`). */
const PrivateJwk = PublicJwk.extend({ d: z.string().min(1) });

/**
 * `JWT_SIGNING_KEYS`: a JSON array of `{ kid, publicJwk, privateJwk?, retiredAt? }`.
 * A retired key still verifies tokens for the grace window after `retiredAt`.
 */
export const JwtKeySchema = z.strictObject({
  kid: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  publicJwk: PublicJwk,
  privateJwk: PrivateJwk.optional(),
  retiredAt: z.iso.datetime({ offset: true }).optional(),
});

const JwtKeysSchema = z
  .string()
  .transform((text, ctx) => {
    try {
      return JSON.parse(text);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'JWT_SIGNING_KEYS must be JSON' });
      return z.NEVER;
    }
  })
  .pipe(z.array(JwtKeySchema).min(1));

/** @typedef {z.output<typeof JwtKeySchema>} JwtKey */
/** @typedef {import('@vouch/contracts').Env & { jwtKeys: JwtKey[] }} Config */

/** Raised when the environment is invalid; lists variable names, never values. */
export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * @param {z.ZodError} error
 * @param {string} [prefix]
 */
function describeIssues(error, prefix = '') {
  return error.issues.map(
    (issue) => `${prefix}${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
}

/**
 * Parses and validates the environment. Throws ConfigError so the process refuses to boot.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Readonly<Config>}
 */
export function loadConfig(env = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(describeIssues(parsed.error));

  const keys = JwtKeysSchema.safeParse(parsed.data.JWT_SIGNING_KEYS);
  if (!keys.success) throw new ConfigError(describeIssues(keys.error, 'JWT_SIGNING_KEYS'));

  const active = keys.data.find((key) => key.kid === parsed.data.JWT_ACTIVE_KID);
  if (!active) throw new ConfigError(['JWT_ACTIVE_KID: no key with this kid in JWT_SIGNING_KEYS']);
  if (active.retiredAt) throw new ConfigError(['JWT_ACTIVE_KID: the active key is retired']);

  return Object.freeze({ ...parsed.data, jwtKeys: keys.data });
}
