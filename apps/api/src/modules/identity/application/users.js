// @ts-check
import { ServiceError } from '@vouch/contracts';

/**
 * Queries behind identity's public API (`api.js`). No PII beyond what modules need.
 * @param {Pick<import('../ports.js').IdentityDeps, 'read'>} deps
 */
export function makeUserQueries({ read }) {
  /** @param {import('../ports.js').UserRecord} user */
  const view = (user) => ({
    id: user.id,
    publicId: user.publicId,
    collegeId: user.collegeId,
    status: user.status,
    birthDate: user.birthDate,
  });

  return {
    /** @param {string} id */
    getUser: async (id) => {
      const user = await read((stores) => stores.users.findById(id));
      return user ? view(user) : null;
    },
    /** @param {readonly string[]} ids */
    getUsersByIds: async (ids) =>
      (await read((stores) => stores.users.findManyByIds(ids))).map(view),
    /**
     * Throws unless the user exists and is active.
     * @param {string} id
     */
    assertActive: async (id) => {
      const user = await read((stores) => stores.users.findById(id));
      if (!user || user.status !== 'active')
        throw new ServiceError('FORBIDDEN', { message: 'This account is not active.' });
    },
  };
}
