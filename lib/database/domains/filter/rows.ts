// Row mapping and keyword writes shared by the filter and server filter
// domains, which store their keywords in tables of the same shape.
import { randomUUID } from 'node:crypto'

import type {
  CreateFilterKeywordInput,
  UpdateFilterKeywordInput
} from '@/lib/database/domains/filter/types'
import type { Db } from '@/lib/database/kysely'
import { insertInChunks } from '@/lib/database/kysely/inList'
import { inSavepoint } from '@/lib/database/kysely/savepoint'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { FilterContext, type FilterKeyword } from '@/lib/types/domain/filter'

export type KeywordTable = 'filter_keywords' | 'server_filter_keywords'

export const KEYWORD_COLUMNS = [
  'id',
  'filterId',
  'keyword',
  'wholeWord',
  'createdAt',
  'updatedAt'
] as const

export type KeywordRow = {
  id: string
  filterId: string
  keyword: string
  wholeWord: boolean
  // Nullable in the schema, but every writer sets them.
  createdAt: number | null
  updatedAt: number | null
}

export const toFilterKeyword = (row: KeywordRow): FilterKeyword => ({
  id: row.id,
  filterId: row.filterId,
  keyword: row.keyword,
  wholeWord: row.wholeWord,
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

// `context` is a JSON array in a `text` column, which the driver hands back
// unparsed. Unknown values and unparsable text are dropped, not thrown.
export const parseFilterContext = (raw: string): FilterContext[] => {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (value): value is FilterContext =>
        typeof value === 'string' &&
        FilterContext.options.includes(value as FilterContext)
    )
  } catch {
    return []
  }
}

export const groupKeywordsByFilter = (rows: KeywordRow[]) => {
  const byFilter = new Map<string, FilterKeyword[]>()
  for (const row of rows) {
    const keyword = toFilterKeyword(row)
    const bucket = byFilter.get(keyword.filterId) ?? []
    bucket.push(keyword)
    byFilter.set(keyword.filterId, bucket)
  }
  return byFilter
}

/**
 * Adds `keywords` to the filter in one or more multi-row inserts. A keyword the
 * filter already has, or repeats within `keywords`, is ignored. `trx` must be
 * the transaction handed to `inTransaction`.
 */
export const insertKeywords = async (
  trx: Db,
  table: KeywordTable,
  filterId: string,
  keywords: CreateFilterKeywordInput[],
  now: Date
): Promise<void> => {
  const rows = keywords.map((keyword) => ({
    id: randomUUID(),
    filterId,
    keyword: keyword.keyword,
    wholeWord: Boolean(keyword.wholeWord),
    createdAt: now,
    updatedAt: now
  }))
  await insertInChunks(trx, rows, (chunk) =>
    trx
      .insertInto(table)
      .values(chunk)
      .onConflict((oc) => oc.columns(['filterId', 'keyword']).doNothing())
      .execute()
  )
}

/**
 * Applies a Mastodon-style `keywords_attributes` list to the filter, in order:
 * `_destroy` deletes a keyword, an `id` renames or re-flags it, and a change
 * without an `id` adds one. Every statement that names a keyword id is also
 * scoped to `filterId`, so a change cannot reach another filter's keyword.
 * `trx` must be the transaction handed to `inTransaction`.
 */
export const applyKeywordChanges = async (
  trx: Db,
  table: KeywordTable,
  filterId: string,
  changes: UpdateFilterKeywordInput[],
  now: Date
): Promise<void> => {
  for (const change of changes) {
    if (change._destroy && change.id) {
      await trx
        .deleteFrom(table)
        .where('id', '=', change.id)
        .where('filterId', '=', filterId)
        .execute()
      continue
    }
    if (change.id) {
      const keywordId = change.id
      if (change.keyword !== undefined || change.wholeWord !== undefined) {
        try {
          await inSavepoint(trx, () =>
            trx
              .updateTable(table)
              .set({
                updatedAt: now,
                ...(change.keyword !== undefined
                  ? { keyword: change.keyword }
                  : {}),
                ...(change.wholeWord !== undefined
                  ? { wholeWord: change.wholeWord }
                  : {})
              })
              .where('id', '=', keywordId)
              .where('filterId', '=', filterId)
              .execute()
          )
        } catch (error) {
          if (!isUniqueConstraintError(error)) throw error
          // Duplicate keyword text — skip silently via savepoint rollback
        }
      }
      continue
    }
    if (change.keyword === undefined) continue
    await insertKeywords(
      trx,
      table,
      filterId,
      [{ keyword: change.keyword, wholeWord: change.wholeWord }],
      now
    )
  }
}
