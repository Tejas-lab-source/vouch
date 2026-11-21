// @ts-check
import { z } from 'zod';

/** Opaque cursor returned by the server; clients never construct one. */
export const Cursor = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/** Query parameters for cursor-paginated lists. */
export const PageQuery = z.strictObject({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * A page of items: `{ items, nextCursor }`. `nextCursor` is null on the last page.
 * @template {z.ZodType} T
 * @param {T} item
 */
export function page(item) {
  return z.strictObject({ items: z.array(item), nextCursor: Cursor.nullable() });
}
