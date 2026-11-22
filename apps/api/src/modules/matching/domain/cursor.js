// @ts-check

/**
 * Opaque list cursor: base64url of `<createdAt ISO>|<matchId>`. Clients never build one.
 * @param {{ createdAt: Date, id: string }} row
 */
export const encodeCursor = (row) =>
  Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');

/**
 * @param {string | undefined} cursor
 * @returns {{ createdAt: Date, id: string } | null}  Null for no cursor or a malformed one.
 */
export function decodeCursor(cursor) {
  if (!cursor) return null;
  const [at = '', id = ''] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(at);
  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { createdAt, id };
}
