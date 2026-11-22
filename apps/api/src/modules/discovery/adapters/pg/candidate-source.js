// @ts-check

/**
 * @param {any} row
 * @returns {import('../../ports.js').Candidate}
 */
const toCandidate = (row) => ({
  userId: row.userId,
  collegeId: row.collegeId,
  gender: row.gender,
  interestedIn: row.interestedIn,
  age: row.age,
  minAge: row.minAge,
  maxAge: row.maxAge,
  lastActiveAt: row.lastActiveAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  approvedPhotos: row.approvedPhotos,
});

/**
 * `CandidateSource` on the published views, as `vouch_discovery` (read only). The candidate
 * query reads one cluster only and runs on the read replica when one is configured.
 * @param {{ db: import('../../../../platform/db.js').Database }} deps
 * @returns {import('../../ports.js').CandidateSource}
 */
export function createCandidateSource({ db }) {
  /** @param {Date} today */
  const day = (today) => today.toISOString().slice(0, 10);

  return {
    viewer: async (userId, today) => {
      const [row] = await db.read(
        'discovery',
        (tx) => tx`
          SELECT c.user_id, c.college_id, c.cluster_id, c.gender, c.interested_in,
            date_part('year', age(${day(today)}::date, c.birth_date))::int AS age,
            c.min_age, c.max_age, c.last_active_at, c.created_at, c.approved_photos::int
          FROM profiles.candidates_v c
          JOIN identity.active_users_v u ON u.id = c.user_id
          WHERE c.user_id = ${userId}`,
      );
      return row ? { ...toCandidate(row), clusterId: row.clusterId } : null;
    },

    candidates: (viewer, today, limit) =>
      db.read(
        'discovery',
        async (tx) =>
          (
            await tx`
              SELECT c.user_id, c.college_id, c.gender, c.interested_in, a.age,
                c.min_age, c.max_age, c.last_active_at, c.created_at, c.approved_photos::int
              FROM profiles.candidates_v c
              JOIN identity.active_users_v u ON u.id = c.user_id
              CROSS JOIN LATERAL (
                SELECT date_part('year', age(${day(today)}::date, c.birth_date))::int AS age
              ) a
              WHERE c.cluster_id = ${viewer.clusterId}
                AND c.user_id <> ${viewer.userId}
                AND c.gender = ANY(${viewer.interestedIn}::smallint[])
                AND ${viewer.gender}::smallint = ANY(c.interested_in)
                AND a.age BETWEEN ${viewer.minAge} AND ${viewer.maxAge}
                AND ${viewer.age} BETWEEN c.min_age AND c.max_age
                AND NOT EXISTS (SELECT 1 FROM matching.seen_v s
                  WHERE s.swiper_id = ${viewer.userId} AND s.target_id = c.user_id)
                AND NOT EXISTS (SELECT 1 FROM safety.block_pairs_v b
                  WHERE b.user_id = ${viewer.userId} AND b.other_id = c.user_id)
              ORDER BY c.last_active_at DESC
              LIMIT ${limit}`
          ).map(toCandidate),
        { replica: true },
      ),

    swipedAmong: async (viewerId, ids) =>
      ids.length === 0
        ? new Set()
        : new Set(
            (
              await db.read(
                'discovery',
                (tx) => tx`SELECT target_id FROM matching.seen_v
                  WHERE swiper_id = ${viewerId} AND target_id = ANY(${ids})`,
                { replica: true },
              )
            ).map((row) => /** @type {string} */ (row.targetId)),
          ),
  };
}
