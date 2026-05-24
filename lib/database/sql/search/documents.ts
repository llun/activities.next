import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  DeleteSearchDocumentParams,
  SearchDocument,
  SearchDocumentEntityType,
  SearchDocumentsParams,
  UpsertSearchDocumentParams
} from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { logger } from '@/lib/utils/logger'

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

const SQLITE_CLIENTS = new Set(['sqlite3', 'better-sqlite3'])
const POSTGRES_CLIENTS = new Set(['pg', 'postgres', 'postgresql'])
const MYSQL_CLIENTS = new Set(['mysql', 'mysql2'])

const getClientName = (database: Knex) =>
  String(database.client.config.client).toLowerCase()

const isSQLite = (database: Knex) => SQLITE_CLIENTS.has(getClientName(database))

const isPostgres = (database: Knex) =>
  POSTGRES_CLIENTS.has(getClientName(database))

const isMySQL = (database: Knex) => MYSQL_CLIENTS.has(getClientName(database))

export const escapeLikePattern = (value: string) =>
  value.replace(/[\\%_]/g, '\\$&')

const DEFAULT_MYSQL_FULL_TEXT_MIN_TOKEN_SIZE = 4
const MIN_MYSQL_LIKE_FALLBACK_TOKEN_LENGTH = 2
const MYSQL_FULL_TEXT_MIN_TOKEN_SIZE_FAILURES_BEFORE_COOLDOWN = 2
const MYSQL_FULL_TEXT_MIN_TOKEN_SIZE_FAILURE_COOLDOWN_MS = 5 * 60 * 1000
const mysqlFullTextMinTokenSizeCache = new WeakMap<Knex, Promise<number>>()
const mysqlFullTextMinTokenSizeFailures = new WeakMap<
  Knex,
  {
    failures: number
    retryAfter: number
  }
>()

const getRawRows = (rawResult: unknown): Record<string, unknown>[] => {
  if (Array.isArray(rawResult)) {
    return Array.isArray(rawResult[0])
      ? (rawResult[0] as Record<string, unknown>[])
      : (rawResult as Record<string, unknown>[])
  }

  if (
    rawResult &&
    typeof rawResult === 'object' &&
    'rows' in rawResult &&
    Array.isArray(rawResult.rows)
  ) {
    return rawResult.rows as Record<string, unknown>[]
  }

  return []
}

const parseFullTextMinTokenSize = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const getMySQLFullTextMinTokenSize = async (database: Knex) => {
  const failure = mysqlFullTextMinTokenSizeFailures.get(database)
  if (failure?.retryAfter && failure.retryAfter > Date.now()) {
    return DEFAULT_MYSQL_FULL_TEXT_MIN_TOKEN_SIZE
  }
  if (failure?.retryAfter) {
    mysqlFullTextMinTokenSizeFailures.delete(database)
  }

  const cached = mysqlFullTextMinTokenSizeCache.get(database)
  if (cached) return cached

  const minTokenSize = database
    .raw(
      'select @@innodb_ft_min_token_size as innodbFtMinTokenSize, @@ft_min_word_len as ftMinWordLen'
    )
    .then((result) => {
      const row = getRawRows(result)[0] ?? {}
      const innodbMinTokenSize = parseFullTextMinTokenSize(
        row.innodbFtMinTokenSize
      )
      mysqlFullTextMinTokenSizeFailures.delete(database)
      return (
        innodbMinTokenSize ??
        parseFullTextMinTokenSize(row.ftMinWordLen) ??
        DEFAULT_MYSQL_FULL_TEXT_MIN_TOKEN_SIZE
      )
    })
    .catch((err) => {
      mysqlFullTextMinTokenSizeCache.delete(database)
      const current = mysqlFullTextMinTokenSizeFailures.get(database)
      const failures = (current?.failures ?? 0) + 1
      const retryAfter =
        failures >= MYSQL_FULL_TEXT_MIN_TOKEN_SIZE_FAILURES_BEFORE_COOLDOWN
          ? Date.now() + MYSQL_FULL_TEXT_MIN_TOKEN_SIZE_FAILURE_COOLDOWN_MS
          : 0
      mysqlFullTextMinTokenSizeFailures.set(database, {
        failures,
        retryAfter
      })
      logger.debug({ err }, 'Failed to read MySQL full-text minimum token size')
      return DEFAULT_MYSQL_FULL_TEXT_MIN_TOKEN_SIZE
    })

  mysqlFullTextMinTokenSizeCache.set(database, minTokenSize)
  return minTokenSize
}

const applyPartialTokenMatch = ({
  query,
  tokens
}: {
  query: Knex.QueryBuilder
  tokens: string[]
}) => {
  tokens.forEach((token) => {
    query.whereRaw("LOWER(??) LIKE ? ESCAPE '\\'", [
      'search_documents.documentText',
      `%${escapeLikePattern(token)}%`
    ])
  })
  return query
}

export const applySearchDocumentFilter = async ({
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

  if (isSQLite(database)) {
    const matchQuery = tokens.map((token) => `${token}*`).join(' ')
    query
      .joinRaw(
        'inner join search_documents_fts on search_documents_fts.rowid = search_documents.rowid'
      )
      .whereRaw('search_documents_fts match ?', [matchQuery])
    return
  }

  if (isPostgres(database)) {
    const tsQuery = tokens.map((token) => `${token}:*`).join(' & ')
    query.whereRaw(`to_tsvector('simple', ??) @@ to_tsquery('simple', ?)`, [
      'documentText',
      tsQuery
    ])
    return
  }

  if (isMySQL(database)) {
    const booleanQuery = tokens.map((token) => `+${token}*`).join(' ')
    const minTokenSize = await getMySQLFullTextMinTokenSize(database)
    if (tokens.some((token) => token.length < minTokenSize)) {
      const fallbackTokens = tokens.filter(
        (token) => token.length >= MIN_MYSQL_LIKE_FALLBACK_TOKEN_LENGTH
      )
      if (fallbackTokens.length === 0) {
        query.whereRaw('1 = 0')
        return
      }
      applyPartialTokenMatch({ query, tokens: fallbackTokens })
      return
    }
    query.whereRaw('MATCH(??) AGAINST (? IN BOOLEAN MODE)', [
      'search_documents.documentText',
      booleanQuery
    ])
    return
  }

  applyPartialTokenMatch({ query, tokens })
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

  // Postgres can express stable null placement in the indexed DESC sort.
  // MySQL and SQLite need a boolean pre-sort for portable NULLS LAST behavior.
  if (isPostgres(database)) {
    query
      .orderByRaw('?? desc nulls last', ['search_documents.postCount'])
      .orderByRaw('?? desc nulls last', ['search_documents.lastPostAt'])
      .orderByRaw('?? desc nulls last', ['search_documents.entityCreatedAt'])
  } else {
    query
      .orderByRaw('?? is null', ['search_documents.postCount'])
      .orderBy('search_documents.postCount', 'desc')
      .orderByRaw('?? is null', ['search_documents.lastPostAt'])
      .orderBy('search_documents.lastPostAt', 'desc')
      .orderByRaw('?? is null', ['search_documents.entityCreatedAt'])
      .orderBy('search_documents.entityCreatedAt', 'desc')
  }

  query.orderBy('search_documents.entityId', 'desc')

  return query
}

const applySearchDocumentAccessFilters = ({
  database,
  query,
  entityType,
  includeNonDiscoverable = false,
  visibleToActorId
}: {
  database: Knex
  query: Knex.QueryBuilder
  entityType?: SearchDocumentEntityType
  includeNonDiscoverable?: boolean
  visibleToActorId?: string | null
}) => {
  const applyAccountFilter = (builder: Knex.QueryBuilder) => {
    if (!includeNonDiscoverable) {
      builder.where('search_documents.discoverable', true)
    }
  }

  const applyStatusFilter = (builder: Knex.QueryBuilder) => {
    const clientName = getClientName(database)
    const fallbackFollowersAudienceExpression = {
      sql: MYSQL_CLIENTS.has(clientName)
        ? "?? = CONCAT(??, '/followers')"
        : "?? = ?? || '/followers'",
      bindings: ['followers_recipients.actorId', 'search_documents.actorId']
    }
    const storedFollowersAudienceExpression = {
      sql: POSTGRES_CLIENTS.has(clientName)
        ? "?? = search_document_actors.settings::jsonb ->> 'followersUrl'"
        : MYSQL_CLIENTS.has(clientName)
          ? "?? = JSON_UNQUOTE(JSON_EXTRACT(search_document_actors.settings, '$.followersUrl'))"
          : "?? = json_extract(search_document_actors.settings, '$.followersUrl')",
      bindings: ['followers_recipients.actorId']
    }

    builder.where((statusBuilder) => {
      statusBuilder.whereIn('search_documents.visibility', [
        'public',
        'unlisted'
      ])
      if (visibleToActorId) {
        statusBuilder
          .orWhere('search_documents.actorId', visibleToActorId)
          .orWhereExists(function () {
            this.select(database.raw('1'))
              .from('recipients as direct_recipients')
              .whereRaw('?? = ??', [
                'direct_recipients.statusId',
                'search_documents.entityId'
              ])
              .where('direct_recipients.actorId', visibleToActorId)
          })
          .orWhereExists(function () {
            this.select(database.raw('1'))
              .from('recipients as followers_recipients')
              .leftJoin(
                'actors as search_document_actors',
                'search_document_actors.id',
                'search_documents.actorId'
              )
              .whereRaw('?? = ??', [
                'followers_recipients.statusId',
                'search_documents.entityId'
              ])
              .where(function () {
                this.whereRaw(
                  storedFollowersAudienceExpression.sql,
                  storedFollowersAudienceExpression.bindings
                ).orWhereRaw(
                  fallbackFollowersAudienceExpression.sql,
                  fallbackFollowersAudienceExpression.bindings
                )
              })
              .whereExists(function () {
                this.select(database.raw('1'))
                  .from('follows')
                  .where('follows.actorId', visibleToActorId)
                  .whereRaw('?? = ??', [
                    'follows.targetActorId',
                    'search_documents.actorId'
                  ])
                  .where('follows.status', FollowStatus.enum.Accepted)
              })
          })
      }
    })
  }

  if (entityType === 'account') {
    applyAccountFilter(query)
    return
  }

  if (entityType === 'status') {
    applyStatusFilter(query)
    return
  }

  if (entityType === 'hashtag') return

  query.where((builder) => {
    builder
      .where((accountBuilder) => {
        accountBuilder.where('search_documents.entityType', 'account')
        applyAccountFilter(accountBuilder)
      })
      .orWhere((statusBuilder) => {
        statusBuilder.where('search_documents.entityType', 'status')
        applyStatusFilter(statusBuilder)
      })
      .orWhere('search_documents.entityType', 'hashtag')
  })
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
    entityCreatedAt:
      params.entityCreatedAt !== null && params.entityCreatedAt !== undefined
        ? new Date(params.entityCreatedAt)
        : null,
    discoverable: params.discoverable ?? null,
    postCount: params.postCount ?? null,
    lastPostAt:
      params.lastPostAt !== null && params.lastPostAt !== undefined
        ? new Date(params.lastPostAt)
        : null,
    createdAt: currentTime,
    updatedAt: currentTime
  }

  await database(SEARCH_DOCUMENTS_TABLE).insert(row).onConflict('id').merge({
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
  {
    entityType,
    q,
    limit,
    offset = 0,
    includeNonDiscoverable,
    visibleToActorId
  }: SearchDocumentsParams
): Promise<SearchDocument[]> => {
  const query = database<SQLSearchDocument>(SEARCH_DOCUMENTS_TABLE).select(
    'search_documents.*'
  )

  if (entityType) {
    query.where('search_documents.entityType', entityType)
  }

  applySearchDocumentAccessFilters({
    database,
    query,
    entityType,
    includeNonDiscoverable,
    visibleToActorId
  })
  await applySearchDocumentFilter({ database, query, q })
  applySearchDocumentOrdering({ database, query, entityType, q })

  const rows = await query.limit(limit).offset(offset)
  return rows.map(toSearchDocument)
}
