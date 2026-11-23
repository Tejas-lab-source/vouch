// @ts-check
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/platform/config.js';
import { createS3Storage } from '../src/modules/media/adapters/storage/s3.js';

/** The web dev and preview servers (apps/web), when `CORS_ORIGINS` is empty. */
export const DEV_WEB_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]);

/**
 * Creates the local bucket in SeaweedFS and its upload CORS rule (`pnpm storage:init`). Development only: in production
 * the R2 bucket, its lifecycle rule and the CDN are set up in Phase 15.
 */
async function main() {
  const config = loadConfig(process.env);
  if (config.NODE_ENV === 'production' || !config.R2_ENDPOINT) {
    throw new Error('storage:init is for the local S3 endpoint only (R2_ENDPOINT)');
  }
  const storage = createS3Storage({
    endpoint: config.R2_ENDPOINT,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    bucket: config.R2_BUCKET,
  });
  await storage.ensureBucket();
  const origins = config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : DEV_WEB_ORIGINS;
  await storage.applyUploadCors(origins);
  process.stdout.write(
    `bucket ${config.R2_BUCKET} ready at ${config.R2_ENDPOINT}; uploads allowed from ${origins.join(', ')}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(
      `storage:init failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
