// @ts-check

/**
 * Processor for `media.processImage` (queue `media`, concurrency `IMAGE_WORKER_CONCURRENCY`).
 * Infrastructure errors are retried with backoff; on the last attempt the upload is rejected
 * as `processing_failed`, so the user is told instead of waiting forever.
 * @param {{
 *   processing: ReturnType<typeof import('../../application/process.js').makeProcessing>,
 *   logger: import('pino').Logger,
 * }} deps
 */
export function processImageJob({ processing, logger }) {
  return async (/** @type {import('bullmq').Job<{ uploadId: string }>} */ job) => {
    try {
      return { outcome: await processing.processUpload({ uploadId: job.data.uploadId }) };
    } catch (error) {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (!lastAttempt) throw error;
      logger.error({ err: error, uploadId: job.data.uploadId }, 'image processing failed');
      return {
        outcome: await processing.rejectAndClean(job.data.uploadId, 'processing_failed'),
      };
    }
  };
}
