import {
  type Expression,
  type ExpressionBuilder,
  type SqlBool,
  type StringReference,
  sql
} from 'kysely'

import type { DB } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'

export type KeysetCursor = {
  createdAt: number | Date
  // The tie-breaker value of the cursor row (its id, or statusId for likes;
  // a number for the integer bookmark id).
  tieBreaker: string | number
}

// Tables with a `createdAt` column, the only ones a keyset can page.
type KeysetTable = {
  [T in keyof DB]: 'createdAt' extends keyof DB[T] ? T : never
}[keyof DB]

/**
 * Rows strictly older (`<`) or newer (`>`) than `cursor` in
 * (createdAt, tieBreaker) order: `createdAt op cursor.createdAt` or, on equal
 * timestamps, `tieBreakerColumn op cursor.tieBreaker`. Both columns are
 * type-checked against the queried table; a query that joins another table with
 * a `createdAt` column passes the qualified one (e.g. `actors.createdAt`).
 */
export const pastKeyset = <TB extends KeysetTable>(
  eb: ExpressionBuilder<DB, TB>,
  cursor: KeysetCursor,
  operator: '<' | '>',
  // NoInfer: TB comes from `eb` only, so another table's column is rejected.
  tieBreakerColumn: NoInfer<StringReference<DB, TB>>,
  createdAtColumn?: NoInfer<StringReference<DB, TB>>
) => {
  const createdAt = timestampValue(cursor.createdAt)
  const createdAtRef = sql.ref(createdAtColumn ?? 'createdAt')
  const tieColumn = sql.ref(tieBreakerColumn)
  return eb.or([
    eb(createdAtRef, operator, createdAt),
    eb.and([
      eb(createdAtRef, '=', createdAt),
      eb(tieColumn, operator, cursor.tieBreaker)
    ])
  ])
}

// A keyset cursor read back from a row: its createdAt may be NULL (the
// columns allow it, though every writer sets one), and a cursor resolved from
// another table may have no tie-breaker.
export type StoredKeysetCursor = {
  createdAt: number | Date | null
  tieBreaker: string | number | null
}

/**
 * pastKeyset for a cursor read back from a row, compared the way the Knex
 * mixins compared one:
 * - with both values, pastKeyset;
 * - with no tie-breaker, createdAt alone;
 * - with a NULL createdAt, Knex bound `createdAt op NULL` (never true) and
 *   compiled the tie arm's two-argument `where('createdAt', null)` to
 *   `createdAt IS NULL`, so only NULL-createdAt rows past the tie-breaker
 *   follow it, and nothing follows a cursor with neither value.
 */
export const pastStoredKeyset = <TB extends KeysetTable>(
  eb: ExpressionBuilder<DB, TB>,
  cursor: StoredKeysetCursor,
  operator: '<' | '>',
  tieBreakerColumn: NoInfer<StringReference<DB, TB>>,
  createdAtColumn?: NoInfer<StringReference<DB, TB>>
): Expression<SqlBool> => {
  const { createdAt, tieBreaker } = cursor
  if (createdAt !== null && tieBreaker !== null) {
    return pastKeyset(
      eb,
      { createdAt, tieBreaker },
      operator,
      tieBreakerColumn,
      createdAtColumn
    )
  }
  const createdAtRef = sql.ref(createdAtColumn ?? 'createdAt')
  if (createdAt !== null) {
    return eb(createdAtRef, operator, timestampValue(createdAt))
  }
  if (tieBreaker === null) return sql<boolean>`1 = 0`
  return eb.and([
    eb(createdAtRef, 'is', null),
    eb(sql.ref(tieBreakerColumn), operator, tieBreaker)
  ])
}
