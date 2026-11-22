// @ts-check

/**
 * @typedef {object} Scored
 * @property {{ userId: string, collegeId?: string }} candidate
 * @property {Map<string, { score: number, reason: string }>} scores  Scorer id → output.
 */

/**
 * @typedef {object} Ranked
 * @property {string} userId
 * @property {number} total
 * @property {string[]} reasons
 * @property {boolean} isNew
 * @property {string | undefined} collegeId
 */

/**
 * @typedef {object} RankingConfig
 * @property {number} base  Added to every candidate's total.
 * @property {Map<string, number>} weights  Scorer id → weight.
 * @property {readonly string[]} gates  Scorer ids that multiply the total (exposure cap).
 * @property {string} newUserScorer  Scorer id whose positive score marks a boosted new user.
 * @property {number} maxNewUsersTop  At most this many boosted new users in the first slots.
 * @property {number} diversifySlots
 * @property {number} size
 */

/**
 * Hand-tuned ranking: total = gates × (base + Σ weight × score). Gated-out candidates are
 * dropped. Ties keep the candidate source's order (most recently active first).
 * @param {readonly Scored[]} scored
 * @param {RankingConfig} config
 * @returns {Ranked[]}
 */
export function rank(scored, config) {
  const ranked = scored.flatMap((entry) => {
    let sum = config.base;
    let gate = 1;
    /** @type {string[]} */
    const reasons = [];
    for (const [id, { score, reason }] of entry.scores) {
      reasons.push(`${id}=${score.toFixed(2)} (${reason})`);
      if (config.gates.includes(id)) gate *= score;
      else sum += (config.weights.get(id) ?? 0) * score;
    }
    if (gate === 0) return [];
    return [
      {
        userId: entry.candidate.userId,
        total: gate * sum,
        reasons,
        isNew: (entry.scores.get(config.newUserScorer)?.score ?? 0) > 0,
        collegeId: entry.candidate.collegeId,
      },
    ];
  });
  ranked.sort((a, b) => b.total - a.total);
  return diversify(ranked, config).slice(0, config.size);
}

/**
 * Reorders the first slots greedily: the best remaining candidate that is not from the same
 * college as the previous card and does not exceed the new-user allowance. When no candidate
 * fits, the best remaining one is taken anyway. Later slots keep their ranked order.
 * @param {readonly Ranked[]} ranked
 * @param {Pick<RankingConfig, 'maxNewUsersTop' | 'diversifySlots'>} config
 * @returns {Ranked[]}
 */
export function diversify(ranked, { maxNewUsersTop, diversifySlots }) {
  const rest = [...ranked];
  /** @type {Ranked[]} */
  const top = [];
  let newUsers = 0;
  while (top.length < diversifySlots && rest.length > 0) {
    const previous = top.at(-1);
    const fits = (/** @type {Ranked} */ r) =>
      (!r.isNew || newUsers < maxNewUsersTop) &&
      (previous === undefined || r.collegeId === undefined || r.collegeId !== previous.collegeId);
    const index = Math.max(0, rest.findIndex(fits));
    const [chosen] = rest.splice(index, 1);
    if (!chosen) break;
    if (chosen.isNew) newUsers += 1;
    top.push(chosen);
  }
  return [...top, ...rest];
}
