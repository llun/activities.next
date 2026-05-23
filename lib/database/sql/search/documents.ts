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

const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, '\\$&')

const DEFAULT_MYSQL_FULL_TEXT_MIN_TOKEN_SIZE = 4
const mysqlFullTextMinTokenSizeCache = new WeakMap<Knex, Promise<number>>()

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
      const myisamMinTokenSize = parseFullTextMinTokenSize(row.ftMinWordLen)

      return Math.max(
        innodbMinTokenSize ?? DEFAULT_MYSQL_FULL_TEXT_MIN_TOKEN_SIZE,
        myisamMinTokenSize ?? DEFAULT_MYSQL_FULL_TEXT_MIN_TOKEN_SIZE
      )
    })
    .catch(() => DEFAULT_MYSQL_FULL_TEXT_MIN_TOKEN_SIZE)

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
      applyPartialTokenMatch({ query, tokens })
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
  query,
  q
}: {
  query: Knex.QueryBuilder
  q: string
}) => {
  const normalizedQuery = q.trim().replace(/^[@#]/, '').toLowerCase()

  query
    .orderByRaw(
      `case
        when lower(??) = ? then 0
        when lower(??) = ? then 1
        when lower(??) like ? then 2
        when lower(??) like ? then 3
        else 4
      end`,
      [
        'search_documents.entityId',
        normalizedQuery,
        'search_documents.documentText',
        normalizedQuery,
        'search_documents.entityId',
        `${normalizedQuery}%`,
        'search_documents.documentText',
        `${normalizedQuery}%`
      ]
    )
    .orderBy('search_documents.postCount', 'desc')
    .orderBy('search_documents.lastPostAt', 'desc')
    .orderBy('search_documents.entityCreatedAt', 'desc')
    .orderBy('search_documents.entityId', 'desc')

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
      sql: clientName.includes('mysql')
        ? "?? = CONCAT(??, '/followers')"
        : "?? = ?? || '/followers'",
      bindings: ['followers_recipients.actorId', 'search_documents.actorId']
    }
    const storedFollowersAudienceExpression = {
      sql: clientName.includes('pg')
        ? "?? = search_document_actors.settings::jsonb ->> 'followersUrl'"
        : clientName.includes('mysql')
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
  applySearchDocumentOrdering({ query, q })

  const rows = await query.limit(limit).offset(offset)
  return rows.map(toSearchDocument)
}
