// @ts-check
import { AGE, getConfig, MESSAGE_BODY } from '@vouch/contracts';
import { contractRoute } from './routes.js';

const BIO_MAX_LENGTH = 500;

/**
 * `GET /v1/config` (Phase 10): what a client needs at start-up and on `config.changed` — the
 * supported app versions, the privacy notice version, flags evaluated for the caller, the
 * caller's college, client-side limits and the registered section types. Works signed out.
 * @param {{
 *   config: import('./config.js').Config,
 *   db: import('./db.js').Database,
 *   flags: { evaluateAll: (subject: import('./flags.js').FlagSubject) => Promise<Record<string, boolean>> },
 *   apis: Map<string, any>,
 *   sections: Map<string, unknown>,
 * }} deps
 */
export function configRoute({ config, db, flags, apis, sections }) {
  const identity = apis.get('identity');
  const profiles = apis.get('profiles');

  /** @param {string} collegeId */
  const collegeOf = async (collegeId) => {
    const [row] = await db.read(
      'platform',
      (tx) => tx`SELECT id, name, cluster_id FROM platform.colleges_v WHERE id = ${collegeId}`,
    );
    return row ? { id: row.id, name: row.name, clusterId: row.clusterId } : null;
  };

  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.route(
      contractRoute(getConfig, async (request) => {
        const actor = /** @type {any} */ (request).user ?? null;
        const user =
          actor?.audience === 'vouch:user' ? await identity?.getUser(actor.userId) : null;
        const appVersion = request.headers['x-app-version'];
        const platform = request.headers['x-platform'];
        return {
          minSupportedVersion: config.APP_MIN_SUPPORTED_VERSION,
          latestVersion: config.APP_LATEST_VERSION,
          privacyNoticeVersion: config.PRIVACY_NOTICE_VERSION,
          flags: await flags.evaluateAll({
            ...(user ? { userId: user.id, collegeId: user.collegeId } : {}),
            ...(typeof appVersion === 'string' ? { appVersion } : {}),
            ...(platform === 'ios' || platform === 'android' || platform === 'web'
              ? { platform }
              : {}),
          }),
          college: user ? await collegeOf(user.collegeId) : null,
          limits: {
            minPhotos: profiles?.minApprovedPhotos ?? 2,
            maxPhotos: config.PHOTOS_MAX,
            maxUploadBytes: config.UPLOAD_MAX_BYTES,
            messageMaxLength: MESSAGE_BODY.MAX,
            bioMaxLength: BIO_MAX_LENGTH,
            minAge: AGE.MIN,
            maxAge: AGE.MAX,
          },
          sectionTypes: [...sections.keys()],
        };
      }),
    );
  };
}
