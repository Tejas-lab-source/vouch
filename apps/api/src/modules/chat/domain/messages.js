// @ts-check

/** Body limits for `text` messages (contracts `MESSAGE_BODY`). */
export const BODY = Object.freeze({ min: 1, max: 1000 });

/**
 * Message kinds (ARCHITECTURE.md extension point: manifest key `messageKinds`). v1 has `text`
 * only; a later kind (for example `photo`) adds a validator here and to the contracts.
 */
export const MESSAGE_KINDS = new Map([
  [
    'text',
    {
      validate: (/** @type {string} */ body) => body.length >= BODY.min && body.length <= BODY.max,
    },
  ],
]);

/**
 * Links in a message: URLs with a scheme, `www.` addresses and bare domains with a common
 * top-level domain. Plain regexes without nested quantifiers (no catastrophic backtracking).
 * @param {string} body
 */
export function countLinks(body) {
  const withScheme = body.match(/\bhttps?:\/\/[^\s]+/gi) ?? [];
  const rest = body.replace(/\bhttps?:\/\/[^\s]+/gi, ' ');
  const www = rest.match(/\bwww\.[^\s]+/gi) ?? [];
  const bare =
    rest
      .replace(/\bwww\.[^\s]+/gi, ' ')
      .match(
        /\b[a-z0-9-]{1,63}\.(?:com|in|net|org|io|me|co|app|link|ly|xyz|info|site|online)\b/gi,
      ) ?? [];
  return withScheme.length + www.length + bare.length;
}

/**
 * The link rule (owner decision, Phase 9): at most `maxPerMessage` links, and none at all in a
 * sender's first `freeAfter` messages of a conversation.
 * @param {{ links: number, senderPriorMessages: number }} facts
 * @param {{ maxPerMessage: number, freeAfter: number }} limits
 * @returns {string | null}  A readable reason to refuse, or null.
 */
export function linkRule({ links, senderPriorMessages }, { maxPerMessage, freeAfter }) {
  if (links === 0) return null;
  if (senderPriorMessages < freeAfter) {
    return `Links can be shared after your first ${freeAfter} messages in a conversation.`;
  }
  if (links > maxPerMessage) return `A message can contain at most ${maxPerMessage} links.`;
  return null;
}
