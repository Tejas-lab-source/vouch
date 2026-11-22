// @ts-check
import { IDENTITY_RETENTION_MS, runRetention } from '../../application/retention.js';
import { createIdentityStores } from '../pg/stores.js';

/**
 * @param {'sessions' | 'devices' | 'deletedUsers'} task
 */
const retentionFor = (task) => new Map(Object.entries(IDENTITY_RETENTION_MS)).get(task) ?? 0;

/**
 * Job processors: the nightly tick enqueues one `identity.retention` job per task with its
 * cutoff; each job purges in one transaction as `vouch_identity`.
 * @param {{ db: import('../../../../platform/db.js').Database, jobs: import('../../../../platform/jobs.js').JobRunner, clock: { now: () => Date } }} deps
 */
export function identityJobs({ db, jobs, clock }) {
  return {
    'identity.retentionTick': async () => {
      const now = clock.now().getTime();
      for (const task of /** @type {const} */ (['sessions', 'devices', 'deletedUsers'])) {
        await jobs.add('identity.retention', {
          task,
          olderThan: new Date(now - retentionFor(task)).toISOString(),
        });
      }
    },
    'identity.retention': async (
      /** @type {{ data: { task: 'sessions' | 'devices' | 'deletedUsers', olderThan: string } }} */ job,
    ) => ({
      deleted: await db.transaction('identity', (tx) =>
        runRetention(
          createIdentityStores(tx).retention,
          job.data.task,
          new Date(job.data.olderThan),
        ),
      ),
    }),
  };
}
