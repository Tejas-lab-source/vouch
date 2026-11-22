// @ts-check

/**
 * Moderation labels that reject or send a photo to review (owner decision, Phase 7; ADR 0013):
 * explicit nudity or sexual content, graphic violence and hate symbols. A label matches by its
 * own name or its parent's, so both Rekognition taxonomy versions are covered. Everything
 * else, including suggestive content such as swimwear, is allowed.
 */
export const BLOCKED_LABELS = Object.freeze([
  'Explicit',
  'Explicit Nudity',
  'Explicit Sexual Activity',
  'Sexual Activity',
  'Graphic Violence',
  'Graphic Violence Or Gore',
  'Visually Disturbing',
  'Hate Symbols',
]);

const BLOCKED = new Set(BLOCKED_LABELS);

/**
 * @typedef {object} ModerationFindings
 * @property {{ name: string, parent: string | null, confidence: number }[]} labels
 * @property {{ ageHigh: number | null }[]} faces  Empty when the age check is off.
 */

/**
 * @typedef {object} ModerationThresholds
 * @property {number} rejectConfidence  A blocked label at or above this rejects (default 80).
 * @property {number} reviewConfidence  A blocked label at or above this, but below reject,
 *   sends the photo to human review (default 50).
 * @property {number} minorAge  A face whose estimated upper age is below this goes to review,
 *   never to rejection (default 18).
 */

/**
 * The verdict for one photo, with the reasons that decided it.
 * @param {ModerationFindings} findings
 * @param {ModerationThresholds} thresholds
 * @returns {{ verdict: 'approve' | 'reject' | 'review', reasons: string[] }}
 */
export function judgeModeration({ labels, faces }, thresholds) {
  const blocked = labels.filter((l) => BLOCKED.has(l.name) || BLOCKED.has(l.parent ?? ''));
  const describe = (/** @type {typeof labels[number]} */ l) =>
    `${l.name} ${Math.round(l.confidence)}%`;

  const rejecting = blocked.filter((l) => l.confidence >= thresholds.rejectConfidence);
  if (rejecting.length > 0) return { verdict: 'reject', reasons: rejecting.map(describe) };

  const reasons = blocked.filter((l) => l.confidence >= thresholds.reviewConfidence).map(describe);
  const possibleMinors = faces.filter((f) => f.ageHigh !== null && f.ageHigh < thresholds.minorAge);
  if (possibleMinors.length > 0) {
    reasons.push(`face estimated under ${thresholds.minorAge} (${possibleMinors.length})`);
  }
  return reasons.length > 0 ? { verdict: 'review', reasons } : { verdict: 'approve', reasons: [] };
}
