import { Knex } from 'knex'

import { getSearchTokens } from '@/lib/database/domains/search/rows'
import type {
  SearchDocument,
  SearchDocumentEntityType
} from '@/lib/database/domains/search/types'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isSQLiteClient } from '@/lib/database/sql/utils/knex'

// Knex versions of the document filter, ordering and row mapper in
// lib/database/domains/search/, for hashtag.ts and status.ts, which build Knex
// queries over search_documents. They go when those two files move to Kysely.

export type SQLSearchDocument = Omit<
  SearchDocument,
  'entityCreatedAt' | 'lastPostAt' | 'createdAt' | 'updatedAt'
> & {
  entityCreatedAt: number | Date | null
  lastPostAt: number | Date | null
  createdAt: number | Date
  updatedAt: number | Date
}

export const SEARCH_DOCUMENTS_TABLE = 'search_documents'

export const applySearchDocumentFilter = ({
  database,
  query,
  q
}: {
  database: Knex
  query: Knex.QueryBuilder
  q: string
}) => {
  const tokens = getSearchTokens(q)
  if (tokens.length === 0) {
    query.whereRaw('1 = 0')
    return
  }

  if (isSQLiteClient(database)) {
    const matchQuery = tokens.map((token) => `${token}*`).join(' ')
    query
      .joinRaw(
        'inner join search_documents_fts on search_documents_fts.rowid = search_documents.rowid'
      )
      .whereRaw('search_documents_fts match ?', [matchQuery])
    return
  }

  const tsQuery = tokens.map((token) => `${token}:*`).join(' & ')
  query.whereRaw(`to_tsvector('simple', ??) @@ to_tsquery('simple', ?)`, [
    'documentText',
    tsQuery
  ])
}

export const applySearchDocumentOrdering = ({
  database,
  query,
  entityType,
  q
}: {
  database: Knex
  query: Knex.QueryBuilder
  entityType?: SearchDocumentEntityType
  q: string
}) => {
  const normalizedQuery = q.trim().replace(/^[@#]/, '').toLowerCase()

  if (entityType === 'hashtag') {
    query.orderByRaw(
      `case
        when lower(??) = ? then 0
        when lower(??) like ? then 1
        else 2
      end`,
      [
        'search_documents.entityId',
        normalizedQuery,
        'search_documents.entityId',
        `${normalizedQuery}%`
      ]
    )
  }

  // Postgres can express stable null placement in the indexed DESC sort;
  // SQLite needs a boolean pre-sort.
  if (isSQLiteClient(database)) {
    query
      .orderByRaw('?? is null', ['search_documents.postCount'])
      .orderBy('search_documents.postCount', 'desc')
      .orderByRaw('?? is null', ['search_documents.lastPostAt'])
      .orderBy('search_documents.lastPostAt', 'desc')
      .orderByRaw('?? is null', ['search_documents.entityCreatedAt'])
      .orderBy('search_documents.entityCreatedAt', 'desc')
  } else {
    query
      .orderByRaw('?? desc nulls last', ['search_documents.postCount'])
      .orderByRaw('?? desc nulls last', ['search_documents.lastPostAt'])
      .orderByRaw('?? desc nulls last', ['search_documents.entityCreatedAt'])
  }

  query.orderBy('search_documents.entityId', 'desc')

  return query
}

export const toSearchDocument = (row: SQLSearchDocument): SearchDocument => ({
  ...row,
  discoverable:
    row.discoverable === null || row.discoverable === undefined
      ? null
      : Boolean(row.discoverable),
  entityCreatedAt:
    row.entityCreatedAt !== null && row.entityCreatedAt !== undefined
      ? getCompatibleTime(row.entityCreatedAt)
      : null,
  lastPostAt:
    row.lastPostAt !== null && row.lastPostAt !== undefined
      ? getCompatibleTime(row.lastPostAt)
      : null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})
