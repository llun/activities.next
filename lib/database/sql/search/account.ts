import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FEDERATION_SIGNING_ACTOR_TYPE,
  FEDERATION_SIGNING_ACTOR_USERNAME,
  isFederationSigningActorUsername
} from '@/lib/services/federation/instanceActor'
import {
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchAccountsParams
} from '@/lib/types/database/operations'
import { SQLActor } from '@/lib/types/database/rows'
import { FollowStatus } from '@/lib/types/domain/follow'
import { parseAccountHandle } from '@/lib/utils/accountHandle'

import {
  SEARCH_DOCUMENTS_TABLE,
  applySearchDocumentFilter,
  deleteSearchDocument,
  escapeLikePattern,
  getSearchDocumentId,
  normalizeSearchText
} from './documents'

const FEDERATION_SIGNING_ACTOR_USERNAME_LIKE_PATTERN = `${FEDERATION_SIGNING_ACTOR_USERNAME.replace(/[\\%_]/g, '\\$&')}%`
const SQLITE_INSERT_PARAMETER_LIMIT = 999
const ACCOUNT_SEARCH_DOCUMENT_DEFAULT_BATCH_SIZE = 500
const SQLITE_CLIENTS = new Set(['sqlite3', 'better-sqlite3'])
const ACCOUNT_ORDER_COLUMNS = {
  username: 'actors.username',
  domain: 'actors.domain'
} as const
const SEARCH_DOCUMENT_MERGE_COLUMNS = [
  'documentText',
  'actorId',
  'visibility',
  'entityCreatedAt',
  'discoverable',
  'postCount',
  'lastPostAt',
  'updatedAt'
]

type AccountSearchActor = Pick<
  SQLActor,
  'id' | 'username' | 'domain' | 'settings' | 'createdAt'
> &
  Partial<
    Pick<SQLActor, 'type' | 'accountId' | 'name' | 'summary' | 'deletionStatus'>
  >

const getAccountDocumentText = (actor: AccountSearchActor) => {
  const acct = `${actor.username}@${actor.domain}`
  return normalizeSearchText(
    [
      actor.username,
      acct,
      `@${acct}`,
      actor.name ?? '',
      actor.summary ?? ''
    ].join(' ')
  )
}

const isDiscoverableAccount = (actor: AccountSearchActor) => {
  const settings = getCompatibleJSON<Record<string, unknown>>(
    actor.settings as string | Record<string, unknown>
  )
  const isInternalFederationActor =
    actor.type === FEDERATION_SIGNING_ACTOR_TYPE &&
    isFederationSigningActorUsername(actor.username) &&
    !actor.accountId
  return (
    settings.noindex !== true &&
    actor.deletionStatus == null &&
    !isInternalFederationActor
  )
}

const getLowerAccountHandleSQL = (database: Knex) => {
  const clientName = String(database.client.config.client)
  if (clientName.includes('mysql')) {
    return "LOWER(CONCAT(??, '@', ??))"
  }
  return "LOWER(?? || '@' || ??)"
}

const getClientName = (database: Knex) =>
  String(database.client.config.client).toLowerCase()

const getAccountSearchDocumentBatchSize = (
  database: Knex,
  row: Record<string, unknown>
) => {
  const columnCount = Math.max(Object.keys(row).length, 1)
  if (SQLITE_CLIENTS.has(getClientName(database))) {
    return Math.max(1, Math.floor(SQLITE_INSERT_PARAMETER_LIMIT / columnCount))
  }
  return ACCOUNT_SEARCH_DOCUMENT_DEFAULT_BATCH_SIZE
}

const applyAccountOrdering = ({
  database,
  query,
  normalizedQuery
}: {
  database: Knex
  query: Knex.QueryBuilder
  normalizedQuery: string
}) => {
  const lowerHandleSQL = getLowerAccountHandleSQL(database)
  const normalizedQueryLikePattern = `${escapeLikePattern(normalizedQuery)}%`
  const orderCases = [
    {
      condition: `${lowerHandleSQL} = ?`,
      bindings: [
        ACCOUNT_ORDER_COLUMNS.username,
        ACCOUNT_ORDER_COLUMNS.domain,
        normalizedQuery
      ],
      rank: 0
    },
    {
      condition: 'lower(??) = ?',
      bindings: [ACCOUNT_ORDER_COLUMNS.username, normalizedQuery],
      rank: 1
    },
    {
      condition: `${lowerHandleSQL} like ? ESCAPE '\\'`,
      bindings: [
        ACCOUNT_ORDER_COLUMNS.username,
        ACCOUNT_ORDER_COLUMNS.domain,
        normalizedQueryLikePattern
      ],
      rank: 2
    },
    {
      condition: "lower(??) like ? ESCAPE '\\'",
      bindings: [ACCOUNT_ORDER_COLUMNS.username, normalizedQueryLikePattern],
      rank: 3
    }
  ]

  query
    .orderByRaw(
      [
        'case',
        ...orderCases.map(
          ({ condition, rank }) => `when ${condition} then ${rank}`
        ),
        `else ${orderCases.length}`,
        'end'
      ].join('\n'),
      orderCases.flatMap(({ bindings }) => bindings)
    )
    .orderByRaw('LOWER(??)', [ACCOUNT_ORDER_COLUMNS.username])
    .orderBy('search_documents.entityId', 'asc')
}

const chunkArray = <T>(items: T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const applySearchableAccountFilters = (query: Knex.QueryBuilder) => {
  query.whereNull('actors.deletionStatus').whereNot((builder) => {
    builder
      .where('actors.type', FEDERATION_SIGNING_ACTOR_TYPE)
      .whereRaw("?? LIKE ? ESCAPE '\\'", [
        'actors.username',
        FEDERATION_SIGNING_ACTOR_USERNAME_LIKE_PATTERN
      ])
      .whereNull('actors.accountId')
  })
}

const applyFollowingFilter = ({
  database,
  query,
  followingActorId
}: {
  database: Knex
  query: Knex.QueryBuilder
  followingActorId?: string | null
}) => {
  if (!followingActorId) return

  query.whereExists(function () {
    this.select(database.raw('1'))
      .from('follows')
      .where('follows.actorId', followingActorId)
      .whereRaw('?? = ??', ['follows.targetActorId', 'actors.id'])
      .where('follows.status', FollowStatus.enum.Accepted)
  })
}

const getExactAccountIds = async ({
  database,
  q,
  localDomain,
  exactActorIds,
  followingActorId
}: {
  database: Knex
  q: string
  localDomain?: string | null
  exactActorIds: string[]
  followingActorId?: string | null
}) => {
  const trimmedQuery = q.trim()
  const handle = parseAccountHandle(trimmedQuery)
  const normalizedLocalDomain = localDomain?.toLowerCase() ?? null
  const localUsername =
    !handle && normalizedLocalDomain && !trimmedQuery.includes('@')
      ? trimmedQuery
      : null
  const exactHandle =
    handle ??
    (localUsername && normalizedLocalDomain
      ? {
          username: localUsername,
          domain: normalizedLocalDomain
        }
      : null)
  const handleActorRows = exactHandle
    ? await database('actors')
        .select<{ id: string }[]>('actors.id')
        .whereRaw('LOWER(??) = ?', [
          'actors.username',
          exactHandle.username.toLowerCase()
        ])
        .whereRaw('LOWER(??) = ?', ['actors.domain', exactHandle.domain])
    : []
  const normalizedExactActorIds = [
    ...new Set([...exactActorIds, ...handleActorRows.map((row) => row.id)])
  ]
  if (normalizedExactActorIds.length === 0) return []

  const query = database('actors')
    .select<{ id: string }[]>('actors.id')
    .whereIn('actors.id', normalizedExactActorIds)
  applySearchableAccountFilters(query)
  applyFollowingFilter({ database, query, followingActorId })

  const rows = await query
  const visibleActorIds = new Set(rows.map((row) => row.id))
  return normalizedExactActorIds.filter((id) => visibleActorIds.has(id))
}

const getActorSearchDocumentRow = (
  actor: AccountSearchActor,
  currentTime: Date
) => ({
  id: getSearchDocumentId({
    entityType: 'account',
    entityId: actor.id
  }),
  entityType: 'account',
  entityId: actor.id,
  documentText: getAccountDocumentText(actor),
  actorId: actor.id,
  visibility: null,
  entityCreatedAt: actor.createdAt
    ? new Date(getCompatibleTime(actor.createdAt))
    : null,
  discoverable: isDiscoverableAccount(actor),
  postCount: null,
  lastPostAt: null,
  createdAt: currentTime,
  updatedAt: currentTime
})

const upsertActorSearchDocuments = async (
  database: Knex,
  actors: AccountSearchActor[]
) => {
  if (actors.length === 0) return

  const currentTime = new Date()
  const rows = actors.map((actor) =>
    getActorSearchDocumentRow(actor, currentTime)
  )

  const batchSize = getAccountSearchDocumentBatchSize(database, rows[0])
  for (const chunk of chunkArray(rows, batchSize)) {
    await database(SEARCH_DOCUMENTS_TABLE)
      .insert(chunk)
      .onConflict('id')
      .merge(SEARCH_DOCUMENT_MERGE_COLUMNS)
  }
}

// Passing a fresh actor row indexes that exact shape; passing only an id
// re-reads actors and deletes the search document if the actor row is gone.
export const indexActorSearchDocument = async (
  database: Knex,
  { id, actor: providedActor }: { id: string; actor?: AccountSearchActor }
): Promise<void> => {
  const actor =
    providedActor ??
    (await database<SQLActor>('actors').where('id', id).first())
  if (!actor) {
    await deleteActorSearchDocument(database, { id })
    return
  }

  await upsertActorSearchDocuments(database, [actor])
}

export const searchAccountIds = async (
  database: Knex,
  {
    q,
    limit,
    offset = 0,
    localDomain,
    followingActorId,
    exactActorIds = []
  }: SearchAccountsParams
): Promise<string[]> => {
  const normalizedQuery = q.trim().replace(/^@/, '').toLowerCase()
  const normalizedExactActorIds = [...new Set(exactActorIds)]
  // Only visible exact matches participate in pagination; filtered exact IDs
  // fall back to the indexed result window instead of reserving page slots.
  const exactResultIds = await getExactAccountIds({
    database,
    q,
    localDomain,
    exactActorIds: normalizedExactActorIds,
    followingActorId
  })
  const exactPageIds =
    offset < exactResultIds.length
      ? exactResultIds.slice(offset, offset + limit)
      : []
  const indexedLimit = limit - exactPageIds.length
  if (indexedLimit <= 0) return exactPageIds
  const indexedOffset = Math.max(offset - exactResultIds.length, 0)

  const query = database(SEARCH_DOCUMENTS_TABLE)
    .innerJoin('actors', 'actors.id', 'search_documents.entityId')
    .select<{ entityId: string }[]>('search_documents.entityId')
    .where('search_documents.entityType', 'account')
  applySearchableAccountFilters(query)

  await applySearchDocumentFilter({ database, query, q })
  if (exactResultIds.length > 0) {
    query.whereNotIn('search_documents.entityId', exactResultIds)
  }

  if (!followingActorId) {
    query.where('search_documents.discoverable', true)
  }

  applyFollowingFilter({ database, query, followingActorId })

  applyAccountOrdering({
    database,
    query,
    normalizedQuery
  })

  const rows = await query.limit(indexedLimit).offset(indexedOffset)
  return [...exactPageIds, ...rows.map((row) => row.entityId)]
}

export const deleteActorSearchDocument = async (
  database: Knex,
  { id }: { id: string }
): Promise<void> => {
  await deleteSearchDocument(database, { entityType: 'account', entityId: id })
}

export const reindexSearchAccounts = async (
  database: Knex,
  { afterId = null, limit = 500 }: ReindexSearchDocumentsParams = {}
): Promise<ReindexSearchDocumentsResult> => {
  // Reindexing walks a snapshot best-effort; normal write paths refresh their
  // own search documents and may temporarily race this batch on live systems.
  const query = database<SQLActor>('actors')
    .select(
      'id',
      'username',
      'domain',
      'settings',
      'createdAt',
      'type',
      'accountId',
      'name',
      'summary',
      'deletionStatus'
    )
    .orderBy('id', 'asc')
  if (afterId) query.where('id', '>', afterId)

  const rows = await query.limit(limit)
  await upsertActorSearchDocuments(database, rows)

  return {
    indexed: rows.length,
    nextCursor: rows.length === limit ? rows[rows.length - 1].id : null
  }
}
