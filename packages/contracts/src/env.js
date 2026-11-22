// @ts-check
import { z } from 'zod';

/**
 * Environment variables for every role and phase. `platform/config.js` (Phase 4) parses
 * `process.env` with this schema and refuses to boot on an error. Secrets have no defaults;
 * development-only adapters are rejected in production.
 */

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const secret = z.string().min(32).describe('Random secret, at least 32 characters.');

export const EnvSchema = z
  .object({
    // Process
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DEPLOY_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    ROLE: z.enum(['api', 'ws', 'worker', 'all']).default('all'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_MIN_SUPPORTED_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .default('0.0.0'),
    APP_LATEST_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .default('0.0.0'),
    PRIVACY_NOTICE_VERSION: z.string().min(1).max(40).default('draft'),
    METRICS_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(9464)
      .describe('Internal port for /metrics; never the public port.'),
    SHUTDOWN_DRAIN_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(29000)
      .default(25000)
      .describe('Graceful drain on SIGTERM; finishes before the host 30 s kill.'),

    // Identity rate limits. Campuses share one public IP, so per-IP limits are high
    // (ADR 0011); per-email and per-device limits do the fine-grained work.
    RATE_LIMIT_OTP_EMAIL_15M: z.coerce.number().int().min(1).default(3),
    RATE_LIMIT_OTP_EMAIL_DAY: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_OTP_IP_HOUR: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_OTP_DEVICE_HOUR: z.coerce.number().int().min(1).default(5),
    RATE_LIMIT_VERIFY_IP_15M: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_REFRESH_SESSION_HOUR: z.coerce.number().int().min(1).default(60),

    // Postgres (one login per module role is configured in Phase 15)
    DATABASE_URL: postgresUrl,
    DATABASE_REPLICA_URL: postgresUrl.optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_PREPARE: z.stringbool().default(true).describe('false behind a transaction pooler.'),

    // Redis
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    // Identity and HTTP
    EMAIL_HMAC_SECRET: secret,
    JWT_SIGNING_KEYS: z
      .string()
      .min(1)
      .describe('JSON array of Ed25519 JWKs with kid; finalised in Phase 5.'),
    JWT_ACTIVE_KID: z.string().min(1),
    COOKIE_SECRET: secret,
    CORS_ORIGINS: csv.pipe(z.array(z.url())).default([]),
    ADMIN_IP_ALLOWLIST: csv.optional(),

    // Object storage (Cloudflare R2; MinIO locally)
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    R2_ENDPOINT: z.url().optional().describe('Override for MinIO in development.'),
    CDN_BASE_URL: z.url(),
    IMAGE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),

    // Third-party providers (development adapters by default)
    EMAIL_PROVIDER: z.enum(['console', 'resend', 'brevo']).default('console'),
    EMAIL_FROM: z.email().optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    BREVO_API_KEY: z.string().min(1).optional(),
    CAPTCHA_PROVIDER: z.enum(['dev', 'turnstile']).default('dev'),
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    PUSH_PROVIDER: z.enum(['log', 'expo']).default('log'),
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
    MODERATION_PROVIDER: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .default('dev')
      .describe('Chosen in Phase 7.'),
    MODERATION_API_KEY: z.string().min(1).optional(),

    // Observability
    SENTRY_DSN: z.url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    METRICS_ENABLED: z.stringbool().default(true),
  })
  .superRefine((env, ctx) => {
    /** @param {string} path @param {string} message */
    const fail = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });

    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY)
      fail('RESEND_API_KEY', 'required for resend');
    if (env.EMAIL_PROVIDER === 'brevo' && !env.BREVO_API_KEY)
      fail('BREVO_API_KEY', 'required for brevo');
    if (env.EMAIL_PROVIDER !== 'console' && !env.EMAIL_FROM)
      fail('EMAIL_FROM', 'required for real email');
    if (env.CAPTCHA_PROVIDER === 'turnstile' && !env.TURNSTILE_SECRET_KEY) {
      fail('TURNSTILE_SECRET_KEY', 'required for turnstile');
    }
    if (env.MODERATION_PROVIDER !== 'dev' && !env.MODERATION_API_KEY) {
      fail('MODERATION_API_KEY', 'required for a real moderation provider');
    }

    if (env.NODE_ENV !== 'production') return;
    if (env.EMAIL_PROVIDER === 'console') fail('EMAIL_PROVIDER', 'console is development-only');
    if (env.CAPTCHA_PROVIDER === 'dev') fail('CAPTCHA_PROVIDER', 'dev is development-only');
    if (env.PUSH_PROVIDER === 'log') fail('PUSH_PROVIDER', 'log is development-only');
    if (env.MODERATION_PROVIDER === 'dev') fail('MODERATION_PROVIDER', 'dev is development-only');
    if (env.R2_ENDPOINT) fail('R2_ENDPOINT', 'MinIO override is development-only');
  });

/** @typedef {z.output<typeof EnvSchema>} Env */
