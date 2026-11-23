// @ts-check

/**
 * Safety's part of the data export (Phase 14, DPDP right of access): the user's own actions
 * and status, never other people's reports about them (that would reveal the reporters).
 * - `blocks`: the people they blocked (public ids) and when
 * - `reportsFiled`: the reports they filed (reason, context, status, dates; no evidence)
 * - `verification`: their ID-card reviews (status and dates; the images are never exported
 *   and are deleted within 30 days of the decision)
 * @param {{ read: <T>(fn: (stores: any) => Promise<T>) => Promise<T>, identity: { getUsersByIds: (ids: readonly string[]) => Promise<{ id: string, publicId: string }[]> } }} deps
 */
export function makeSafetyExport({ read, identity }) {
  /** @param {string} userId */
  return async (userId) => {
    /** @type {{ blocks: any[], reports: any[], reviews: any[] }} */
    const { blocks, reports, reviews } = await read(async (stores) => ({
      blocks: await stores.blocks.blockedBy(userId),
      reports: await stores.reports.filedBy(userId),
      reviews: await stores.verifications.forUser(userId),
    }));
    const ids = [
      ...new Set([...blocks.map((b) => b.blockedId), ...reports.map((r) => r.targetId)]),
    ];
    const publicIds = new Map((await identity.getUsersByIds(ids)).map((u) => [u.id, u.publicId]));
    const pub = (/** @type {string} */ id) => publicIds.get(id) ?? 'erased-account';
    return {
      blocks: blocks.map((b) => ({
        userId: pub(b.blockedId),
        blockedAt: b.createdAt.toISOString(),
      })),
      reportsFiled: reports.map((r) => ({
        aboutUserId: pub(r.targetId),
        context: r.context,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        closedAt: r.closedAt?.toISOString() ?? null,
      })),
      verification: reviews.map((v) => ({
        status: v.status,
        submittedAt: v.submittedAt.toISOString(),
        decidedAt: v.decidedAt?.toISOString() ?? null,
      })),
    };
  };
}
