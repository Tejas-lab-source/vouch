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
    PRIVACY_NOTICE_VERSION: z.string().min(1).max(40).default('2026-11-draft'),
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
    REFRESH_REUSE_GRACE_SECONDS: z.coerce
      .number()
      .int()
      .min(0)
      .max(300)
      .default(30)
      .describe(
        'A rotated refresh token retried this soon gets a fresh pair (ADR 0011); 0 disables.',
      ),

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
    TRUSTED_PROXIES: csv
      .pipe(z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()])))
      .default([])
      .describe(
        'Proxies whose forwarded client IP is believed (ADR 0015). Empty: the socket address.',
      ),
    RATE_LIMIT_USER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .default(300)
      .describe('Global limit per signed-in user, per minute.'),
    SOCKET_REFRESH_GRACE_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(600)
      .default(60)
      .describe('A socket whose token expired gets this long to send auth.refresh.'),
    RATE_LIMIT_MESSAGES_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .default(60)
      .describe('Chat messages per user per minute (fails open).'),
    CHAT_MAX_LINKS_PER_MESSAGE: z.coerce.number().int().min(0).max(10).default(2),
    CHAT_LINKS_AFTER_MESSAGES: z.coerce
      .number()
      .int()
      .min(0)
      .max(50)
      .default(3)
      .describe('No links in a sender’s first N messages of a conversation.'),
    RATE_LIMIT_IP_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .default(1000)
      .describe('Global limit per client IP for unauthenticated or rejected requests, per minute.'),
    ADMIN_IP_ALLOWLIST: csv.optional(),

    // Admin accounts (Phase 10, ADR 0018)
    ADMIN_TOTP_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/)
      .optional()
      .describe('Base64 32-byte key encrypting admin TOTP secrets (AES-256-GCM).'),
    ADMIN_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(60),

    // Notifications and moderation (Phase 10)
    PUSH_MESSAGE_BATCH_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3600)
      .default(30)
      .describe('At most one message push per conversation in this window.'),
    ADMIN_ALERT_EMAIL: z.email().optional().describe('Where new-report alerts are emailed.'),
    REPORT_AUTOHIDE_REPORTERS: z.coerce.number().int().min(1).max(100).default(3),
    REPORT_AUTOHIDE_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    REPORTS_PER_DAY: z.coerce.number().int().min(1).max(1000).default(20),
    PHOTO_REJECTIONS_FOR_REVIEW: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(3)
      .describe('Rejected photos (30 days) that open a system report.'),
    ID_CARD_FALLBACK: z
      .stringbool()
      .default(true)
      .describe('Allow sign-up with any email plus a reviewed student ID and selfie.'),

    // Object storage (Cloudflare R2; SeaweedFS locally, ADR 0012)
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    R2_ENDPOINT: z.url().optional().describe('Local S3 endpoint (SeaweedFS) in development.'),
    CDN_BASE_URL: z.url().describe('Public base URL for photo variants; keys are appended.'),
    IMAGE_WORKER_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(16)
      .default(1)
      .describe('Images processed at once per worker; 1 fits a 512 MB instance.'),

    // Photos and uploads (ADR 0012)
    PHOTOS_MAX: z.coerce.number().int().min(2).max(6).default(6),
    UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(10_485_760).default(10_485_760),
    UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
    IMAGE_WEBP_QUALITY: z.coerce.number().int().min(1).max(100).default(80),
    IMAGE_MAX_PIXELS: z.coerce
      .number()
      .int()
      .min(1_000_000)
      .max(100_000_000)
      .default(50_000_000)
      .describe('Larger images are rejected before decoding (decompression bombs).'),

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
      .describe("'dev' or 'rekognition' (Phase 7, ADR 0013)."),
    MODERATION_API_KEY: z
      .string()
      .min(1)
      .optional()
      .describe('For rekognition: the AWS secret access key.'),

    // Photo moderation (ADR 0013). Confidence values are percentages.
    MODERATION_AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    MODERATION_AWS_REGION: z
      .string()
      .regex(/^[a-z]{2}-[a-z]{4,10}-[0-9]$/)
      .default('ap-south-1'),
    MODERATION_ENDPOINT: z.url().optional().describe('Test-only endpoint override.'),
    MODERATION_REJECT_CONFIDENCE: z.coerce.number().min(1).max(100).default(80),
    MODERATION_REVIEW_CONFIDENCE: z.coerce.number().min(1).max(100).default(50),
    MODERATION_FACE_AGE_CHECK: z.stringbool().default(true),
    MODERATION_MINOR_AGE: z.coerce
      .number()
      .int()
      .min(13)
      .max(25)
      .default(18)
      .describe('Review a photo when a face’s estimated AgeRange.High is below this.'),

    // Discovery ranking (ADR 0014). Weights are relative and need not sum to 1.
    DISCOVERY_WEIGHT_BASE: z.coerce.number().min(0).max(10).default(0.25),
    DISCOVERY_WEIGHT_RECENCY: z.coerce.number().min(0).max(10).default(0.35),
    DISCOVERY_WEIGHT_COMPLETENESS: z.coerce.number().min(0).max(10).default(0.15),
    DISCOVERY_WEIGHT_NEW_USER: z.coerce.number().min(0).max(10).default(0.25),
    DISCOVERY_RECENCY_HALF_LIFE_HOURS: z.coerce.number().min(1).max(720).default(72),
    DISCOVERY_NEW_USER_DAYS: z.coerce.number().int().min(1).max(60).default(7),
    DISCOVERY_EXPOSURE_CAP: z.coerce.number().int().min(1).max(100_000).default(300),
    DISCOVERY_MAX_NEW_USERS_TOP10: z.coerce.number().int().min(0).max(10).default(3),

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
    if (!env.R2_ENDPOINT && !env.R2_ACCOUNT_ID) {
      fail('R2_ACCOUNT_ID', 'required for Cloudflare R2 (or set R2_ENDPOINT locally)');
    }
    if (env.MODERATION_PROVIDER !== 'dev' && !env.MODERATION_API_KEY) {
      fail('MODERATION_API_KEY', 'required for a real moderation provider');
    }
    if (env.MODERATION_PROVIDER === 'rekognition' && !env.MODERATION_AWS_ACCESS_KEY_ID) {
      fail('MODERATION_AWS_ACCESS_KEY_ID', 'required for rekognition');
    }
    if (env.MODERATION_REVIEW_CONFIDENCE > env.MODERATION_REJECT_CONFIDENCE) {
      fail('MODERATION_REVIEW_CONFIDENCE', 'must not exceed MODERATION_REJECT_CONFIDENCE');
    }

    if (env.NODE_ENV !== 'production') return;
    if (env.EMAIL_PROVIDER === 'console') fail('EMAIL_PROVIDER', 'console is development-only');
    if (env.CAPTCHA_PROVIDER === 'dev') fail('CAPTCHA_PROVIDER', 'dev is development-only');
    if (env.PUSH_PROVIDER === 'log') fail('PUSH_PROVIDER', 'log is development-only');
    if (env.MODERATION_PROVIDER === 'dev') fail('MODERATION_PROVIDER', 'dev is development-only');
    if (!env.ADMIN_TOTP_KEY) fail('ADMIN_TOTP_KEY', 'required in production');
    if (env.MODERATION_ENDPOINT) fail('MODERATION_ENDPOINT', 'the endpoint override is test-only');
    if (env.R2_ENDPOINT) fail('R2_ENDPOINT', 'the local S3 endpoint is development-only');
  });

/** @typedef {z.output<typeof EnvSchema>} Env */
