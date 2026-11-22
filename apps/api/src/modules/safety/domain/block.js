// @ts-check

/**
 * A block is stored one way (blocker → blocked) and applies both ways for visibility: neither
 * user sees the other in decks, matches or chats (`safety.block_pairs_v`). Nobody blocks
 * themselves.
 * @param {string} blockerId
 * @param {string} blockedId
 */
export function canBlock(blockerId, blockedId) {
  return blockerId !== blockedId;
}
