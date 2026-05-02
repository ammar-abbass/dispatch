/**
 * Cursor-based pagination utilities.
 *
 * Cursor encodes: { id, createdAt } → base64url JSON string.
 * This is opaque to callers — never rely on its internal structure.
 */

export interface CursorPayload {
  id: string;
  createdAt: string; // ISO string
}

export interface PaginationMeta {
  total: number;
  cursor: string | null;
  hasMore: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as CursorPayload;
  } catch {
    throw new Error('Invalid cursor');
  }
}

/**
 * Build a Prisma `where` clause extension from a cursor string.
 * Items are ordered by (createdAt DESC, id DESC), so "after cursor" means:
 *   createdAt < cursor.createdAt  OR  (createdAt = cursor.createdAt AND id < cursor.id)
 */
export function buildCursorWhere(cursor?: string): object {
  if (!cursor) return {};
  const { id, createdAt } = decodeCursor(cursor);
  return {
    OR: [
      { createdAt: { lt: new Date(createdAt) } },
      { createdAt: { equals: new Date(createdAt) }, id: { lt: id } },
    ],
  };
}

/**
 * Build a PaginatedResult from a list of items + total count.
 * Items must include `id` and `createdAt` fields.
 */
export function paginate<T extends { id: string; createdAt: Date }>(
  items: T[],
  total: number,
  limit: number,
): PaginatedResult<T> {
  const hasMore = items.length === limit;
  const lastItem = items.at(-1);
  const cursor =
    hasMore && lastItem
      ? encodeCursor({ id: lastItem.id, createdAt: lastItem.createdAt.toISOString() })
      : null;

  return {
    data: items,
    meta: { total, cursor, hasMore },
  };
}
