import { type ExpressionBuilder, type StringReference, sql } from 'kysely'

import type { DB } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'

export type KeysetCursor = {
  createdAt: number | Date
  // The tie-breaker value of the cursor row (its id, or statusId for likes).
  tieBreaker: string
}

// Tables with a `createdAt` column, the only ones a keyset can page.
type KeysetTable = {
  [T in keyof DB]: 'createdAt' extends keyof DB[T] ? T : never
}[keyof DB]

/**
 * Rows strictly older (`<`) or newer (`>`) than `cursor` in
 * (createdAt, tieBreaker) order: `createdAt op cursor.createdAt` or, on equal
 * timestamps, `tieBreakerColumn op cursor.tieBreaker`. The tie-breaker column is
 * type-checked against the queried table; `createdAt` is referenced unqualified,
 * so a joined query needs a qualified variant.
 */
export const pastKeyset = <TB extends KeysetTable>(
  eb: ExpressionBuilder<DB, TB>,
  cursor: KeysetCursor,
  operator: '<' | '>',
  // NoInfer: TB comes from `eb` only, so another table's column is rejected.
  tieBreakerColumn: NoInfer<StringReference<DB, TB>>
) => {
  const createdAt = timestampValue(cursor.createdAt)
  const createdAtColumn = sql.ref('createdAt')
  const tieColumn = sql.ref(tieBreakerColumn)
  return eb.or([
    eb(createdAtColumn, operator, createdAt),
    eb.and([
      eb(createdAtColumn, '=', createdAt),
      eb(tieColumn, operator, cursor.tieBreaker)
    ])
  ])
}
