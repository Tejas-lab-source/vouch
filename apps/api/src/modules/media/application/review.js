// @ts-check
import { ServiceError } from '@vouch/contracts';
import { keys, VERIFICATION_PREFIX } from '../domain/upload.js';

/** Signed read URLs for private images last this long. */
export const PRIVATE_URL_TTL_SECONDS = 300;
const REVIEW_ALERT_HOURS = 48;

/**
 * The photo review queue (Phase 10) and private ID-card objects. Photos held for review and
 * ID images are never public: staff see them only through 5-minute signed URLs.
 * @param {Pick<import('../ports.js').MediaDeps, 'read' | 'storage' | 'clock' | 'logger' | 'settings'> & { metrics?: { setGauge: (name: string, help: string, labels: Record<string, string>, value: number) => void } }} deps
 */
export function makeReview({ read, storage, clock, logger, settings, metrics }) {
  /** @param {string} key */
  const signed = (key) => storage.presignGet({ key, expiresInSeconds: PRIVATE_URL_TTL_SECONDS });

  /** @param {string} key */
  const assertPrivateKey = (key) => {
    if (!key.startsWith(VERIFICATION_PREFIX) || key.includes('..')) {
      throw new ServiceError('VALIDATION_FAILED');
    }
  };

  return {
    /**
     * Photos waiting for a human decision, oldest first, with signed URLs of the held
     * variants.
     * @param {{ afterId: string | null, limit: number }} page
     */
    async listInReview({ afterId, limit }) {
      const rows = await read((stores) => stores.uploads.listInReview(afterId, limit));
      return Promise.all(
        rows.map(async (row) => ({
          uploadId: row.id,
          userId: row.userId,
          flaggedAt: row.flaggedAt,
          urls: {
            w400: await signed(keys.review(row.id, 'w400')),
            w1080: await signed(keys.review(row.id, 'w1080')),
          },
        })),
      );
    },

    /**
     * `media.reviewAlert` (hourly): photos in review for more than 48 hours. Sets a gauge
     * and logs an error while any exist (owner note, Phase 7 plan).
     */
    async reviewAlert() {
      const cutoff = new Date(clock.now().getTime() - REVIEW_ALERT_HOURS * 3600 * 1000);
      const overdue = await read((stores) => stores.uploads.countInReviewBefore(cutoff));
      metrics?.setGauge(
        'vouch_photo_reviews_overdue',
        'Photos in review for more than 48 hours.',
        {},
        overdue,
      );
      if (overdue > 0) logger.error({ overdue }, 'photos waiting for review over 48 hours');
      return { overdue };
    },

    /** Private objects under `verification/` (ID cards and selfies). */
    privateObjects: {
      /** @param {{ key: string, contentType: string, contentLength: number }} input */
      presignPut: async ({ key, contentType, contentLength }) => {
        assertPrivateKey(key);
        return storage.presignPut({
          key,
          contentType,
          contentLength,
          expiresInSeconds: settings.uploadUrlTtlSeconds,
        });
      },
      /** @param {string} key */
      exists: async (key) => {
        assertPrivateKey(key);
        return (await storage.head(key)) !== null;
      },
      /** @param {string} key */
      signedUrl: async (key) => {
        assertPrivateKey(key);
        return signed(key);
      },
      /** @param {readonly string[]} objectKeys */
      remove: async (objectKeys) => {
        objectKeys.forEach(assertPrivateKey);
        if (objectKeys.length > 0) await storage.remove(objectKeys);
      },
    },
  };
}
