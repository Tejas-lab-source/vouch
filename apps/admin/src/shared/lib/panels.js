// @ts-check

/**
 * Reads a dotted path (`evidence.note`) from a row, without dynamic property access.
 * @param {unknown} row @param {string} path
 * @returns {unknown}
 */
export function getPath(row, path) {
  /** @type {unknown} */
  let value = row;
  for (const part of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = new Map(Object.entries(/** @type {object} */ (value))).get(part);
  }
  return value;
}

/**
 * A row's own id: its first field named `id` or ending in `Id` (`reportId`, `photoId`,
 * `reviewId`, `banId`). Panel actions and detail endpoints take it as their `{id}` path
 * parameter (the panel contract, Phase 10).
 * @param {object} row
 * @returns {string | null}
 */
export function rowId(row) {
  const entry = Object.entries(row).find(([key]) => key === 'id' || key.endsWith('Id'));
  return entry && typeof entry[1] === 'string' ? entry[1] : null;
}

/** @param {string} path @returns {string[]} the `{name}` placeholders of an endpoint path */
export const pathParams = (path) =>
  [...path.matchAll(/\{(\w+)\}/g)].map((m) => /** @type {string} */ (m[1]));
