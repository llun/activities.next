import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  DeleteSearchDocumentParams,
  SearchDocument,
  SearchDocumentEntityType,
  SearchDocumentsParams,
  UpsertSearchDocumentParams
} from '@/lib/types/database/operations'

type SQLSearchDocument = Omit<
  SearchDocument,
  'entityCreatedAt' | 'lastPostAt' | 'createdAt' | 'updatedAt'
> & {
  entityCreatedAt: number | Date | null
  lastPostAt: number | Date | null
  createdAt: number | Date
  updatedAt: number | Date
}

export const SEARCH_DOCUMENTS_TABLE = 'search_documents'

export const getSearchDocumentId = ({
  entityType,
  entityId
}: {
  entityType: SearchDocumentEntityType
  entityId: string
}) => `${entityType}:${entityId}`

export const normalizeSearchText = (value: string) =>
  value.replace(/\s+/g, ' ').trim()

export const getSearchTokens = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .trim()
        .toLowerCase()
        .match(/[\p{L}\p{N}_]+/gu)
        ?.filter((token) => token.length > 0) ?? []
    )
  )

const getClientName = (database: Knex) => String(database.client.config.client)

const isSQLite = (database: Knex) => {
  const clientName = getClientName(database)
  return clientName.includes('sqlite') || clientName.includes('better-sqlite3')
}

const isPostgres = (database: Knex) => getClientName(database).includes('pg')

const isMySQL = (database: Knex) => getClientName(database).includes('mysql')

const applyPartialTokenMatch = ({
  query,
  tokens
}: {
  query: Knex.QueryBuilder
  tokens: string[]
}) => {
  tokens.forEach((token) => {
    query.whereRaw('LOWER(??) LIKE ?', [
      'search_documents.documentText',
      `%${token}%`
    ])
  })
  return query
}

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
    return query
  }

  if (isSQLite(database)) {
    const matchQuery = tokens.map((token) => `${token}*`).join(' ')
    query
      .joinRaw(
        'inner join search_documents_fts on search_documents_fts.rowid = search_documents.rowid'
      )
      .whereRaw('search_documents_fts match ?', [matchQuery])
    return query
  }

  if (isPostgres(database)) {
    const tsQuery = tokens.map((token) => `${token}:*`).join(' & ')
    query.whereRaw(
      `to_tsvector('simple', "search_documents"."documentText") @@ to_tsquery('simple', ?)`,
      [tsQuery]
    )
    return query
  }

  if (isMySQL(database)) {
    const booleanQuery = tokens.map((token) => `+${token}*`).join(' ')
    if (tokens.some((token) => token.length < 3)) {
      return applyPartialTokenMatch({ query, tokens })
    }
    query.whereRaw('MATCH(??) AGAINST (? IN BOOLEAN MODE)', [
      'search_documents.documentText',
      booleanQuery
    ])
    return query
  }

  return applyPartialTokenMatch({ query, tokens })
}

export const applySearchDocumentOrdering = ({
  query,
  q
}: {
  query: Knex.QueryBuilder
  q: string
}) => {
  const normalizedQuery = q.trim().replace(/^[@#]/, '').toLowerCase()

  query
    .orderByRaw(
      'case when lower(??) = ? then 0 when lower(??) like ? then 1 else 2 end',
      [
        'search_documents.entityId',
        normalizedQuery,
        'search_documents.entityId',
        `${normalizedQuery}%`
      ]
    )
    .orderBy('search_documents.postCount', 'desc')
    .orderBy('search_documents.lastPostAt', 'desc')
    .orderBy('search_documents.entityCreatedAt', 'desc')
    .orderBy('search_documents.entityId', 'desc')

  return query
}

export const toSearchDocument = (row: SQLSearchDocument): SearchDocument => ({
  ...row,
  discoverable:
    row.discoverable === null || row.discoverable === undefined
      ? null
      : Boolean(row.discoverable),
  entityCreatedAt: row.entityCreatedAt
    ? getCompatibleTime(row.entityCreatedAt)
    : null,
  lastPostAt: row.lastPostAt ? getCompatibleTime(row.lastPostAt) : null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const upsertSearchDocument = async (
  database: Knex,
  params: UpsertSearchDocumentParams
) => {
  const currentTime = new Date()
  const row = {
    id: getSearchDocumentId(params),
    entityType: params.entityType,
    entityId: params.entityId,
    documentText: normalizeSearchText(params.documentText),
    actorId: params.actorId ?? null,
    visibility: params.visibility ?? null,
    entityCreatedAt: params.entityCreatedAt
      ? new Date(params.entityCreatedAt)
      : null,
    discoverable: params.discoverable ?? null,
    postCount: params.postCount ?? null,
    lastPostAt: params.lastPostAt ? new Date(params.lastPostAt) : null,
    createdAt: currentTime,
    updatedAt: currentTime
  }

  await database(SEARCH_DOCUMENTS_TABLE)
    .insert(row)
    .onConflict(['entityType', 'entityId'])
    .merge({
      documentText: row.documentText,
      actorId: row.actorId,
      visibility: row.visibility,
      entityCreatedAt: row.entityCreatedAt,
      discoverable: row.discoverable,
      postCount: row.postCount,
      lastPostAt: row.lastPostAt,
      updatedAt: currentTime
    })
}

export const deleteSearchDocument = async (
  database: Knex,
  { entityType, entityId }: DeleteSearchDocumentParams
) => {
  await database(SEARCH_DOCUMENTS_TABLE)
    .where({ entityType, entityId })
    .delete()
}

export const searchDocuments = async (
  database: Knex,
  { entityType, q, limit, offset = 0 }: SearchDocumentsParams
): Promise<SearchDocument[]> => {
  const query = database<SQLSearchDocument>(SEARCH_DOCUMENTS_TABLE).select(
    'search_documents.*'
  )

  if (entityType) {
    query.where('search_documents.entityType', entityType)
  }

  applySearchDocumentFilter({ database, query, q })
  applySearchDocumentOrdering({ query, q })

  const rows = await query.limit(limit).offset(offset)
  return rows.map(toSearchDocument)
}
