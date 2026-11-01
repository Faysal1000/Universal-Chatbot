import { type AnyColumn, and, desc, eq, lt, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApplicationError } from '../errors/application-error.js';

/** Position after the last row of a page, for lists ordered by (timestamp, id) descending. */
export interface KeysetPosition {
  readonly timestamp: Date;
  readonly id: string;
}

/**
 * Postgres keeps microseconds but a cursor carries a JS Date (milliseconds), so lists order and
 * compare by the millisecond; otherwise rows a few microseconds apart could fall between pages.
 */
function toMilliseconds(timestampColumn: AnyColumn): SQL {
  return sql`date_trunc('milliseconds', ${timestampColumn})`;
}

export function keysetOrder(timestampColumn: AnyColumn, idColumn: AnyColumn): SQL[] {
  return [desc(toMilliseconds(timestampColumn)), desc(idColumn)];
}

export function keysetBefore(timestampColumn: AnyColumn, idColumn: AnyColumn, position: KeysetPosition): SQL {
  const cursorTimestamp = sql`${position.timestamp.toISOString()}::timestamptz`;
  const timestamp = toMilliseconds(timestampColumn);
  return or(
    lt(timestamp, cursorTimestamp),
    and(eq(timestamp, cursorTimestamp), lt(idColumn, position.id)),
  ) as SQL;
}

const cursorPayloadSchema = z.object({ timestamp: z.iso.datetime(), id: z.uuid() });

/** Opaque to clients: base64url JSON, so the ordering can change without breaking them. */
function encodeKeysetCursor(position: KeysetPosition): string {
  const payload = { timestamp: position.timestamp.toISOString(), id: position.id };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeKeysetCursor(cursor: string): KeysetPosition {
  try {
    const payload = cursorPayloadSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { timestamp: new Date(payload.timestamp), id: payload.id };
  } catch {
    throw new ApplicationError(422, 'validation_failed', 'The request is invalid.', {
      fieldErrors: [{ field: 'cursor', message: 'The cursor is invalid or expired.' }],
    });
  }
}

/** Builds a page from `pageSize + 1` rows: the extra row only tells whether more exist. */
export function toPage<Row, Item>(
  rows: readonly Row[],
  pageSize: number,
  present: (row: Row) => Item,
  positionOf: (row: Row) => KeysetPosition,
): { readonly items: Item[]; readonly nextCursor: string | null } {
  const pageRows = rows.slice(0, pageSize);
  const lastRow = pageRows.at(-1);
  return {
    items: pageRows.map(present),
    nextCursor:
      rows.length > pageSize && lastRow !== undefined ? encodeKeysetCursor(positionOf(lastRow)) : null,
  };
}
