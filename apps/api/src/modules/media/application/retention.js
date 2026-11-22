// @ts-check
import { objectsOf, UPLOAD_ROW_RETENTION_MS } from '../domain/upload.js';

const BATCH = 1000;

/**
 * Nightly retention (`media.retentionTick`): deletes finished upload rows older than 7 days in
 * batches, and any objects they could still own (a never-confirmed upload's raw object; R2's
 * 1-day lifecycle rule normally removed it already).
 * @param {Pick<import('../ports.js').MediaDeps, 'uow' | 'storage' | 'clock'>} deps
 */
export function makeRetention({ uow, storage, clock }) {
  return async function purgeUploads() {
    const olderThan = new Date(clock.now().getTime() - UPLOAD_ROW_RETENTION_MS);
    let deleted = 0;
    for (;;) {
      const rows = await uow.run(({ stores }) => stores.uploads.purgeFinished(olderThan, BATCH));
      if (rows.length > 0) await storage.remove(rows.flatMap((row) => objectsOf(row)));
      deleted += rows.length;
      if (rows.length < BATCH) return { deleted };
    }
  };
}
