import {
  type ExpressionBuilder,
  type SelectQueryBuilder,
  type SqlBool,
  sql
} from 'kysely'

import {
  type SearchDocumentRow,
  deleteSearchDocument,
  matchDocumentText,
  upsertDocuments
} from '@/lib/database/domains/search/documents'
import {
  escapeLikePattern,
  getSearchDocumentId,
  normalizeSearchText
} from '@/lib/database/domains/search/rows'
import type {
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchAccountsParams
} from '@/lib/database/domains/search/types'
import type { DB, Db } from '@/lib/database/kysely'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FEDERATION_SIGNING_ACTOR_TYPE,
  FEDERATION_SIGNING_ACTOR_USERNAME,
  isFederationSigningActorUsername
} from '@/lib/services/federation/instanceActor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { parseAccountHandle } from '@/lib/utils/accountHandle'

const FEDERATION_SIGNING_ACTOR_USERNAME_LIKE_PATTERN = `${escapeLikePattern(FEDERATION_SIGNING_ACTOR_USERNAME)}%`

// An actor as the search index reads it. Callers inside a Knex transaction hand
// over the row they just wrote, so `settings` may still be JSON text and
// `createdAt` a Date; a row read here has them parsed.
type AccountSearchActor = {
  id: string
  username: string | null
  domain: string | null
  settings: unknown
  createdAt: number | Date | null
  type?: string | null
  accountId?: string | null
  name?: string | null
  summary?: string | null
  deletionStatus?: string | null
}

const ACTOR_COLUMNS = [
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
] as const

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
    isFederationSigningActorUsername(actor.username ?? '') &&
    !actor.accountId
  return (
    settings.noindex !== true &&
    actor.deletionStatus == null &&
    !isInternalFederationActor
  )
}

// Not being deleted, and not the internal federation signing actor, which has
// no profile page to find.
const isSearchableAccount = (eb: ExpressionBuilder<DB, 'actors'>) =>
  eb.and([
    eb('actors.deletionStatus', 'is', null),
    eb.not(
      eb.and([
        eb('actors.type', '=', FEDERATION_SIGNING_ACTOR_TYPE),
        sql<SqlBool>`${sql.ref('actors.username')} like ${FEDERATION_SIGNING_ACTOR_USERNAME_LIKE_PATTERN} escape '\\'`,
        eb('actors.accountId', 'is', null)
      ])
    )
  ])

// Mastodon counts the searcher among the accounts they follow
// (AccountSearchService#following_ids appends the account's own id), so a
// client picking list members with `following=true` can offer the owner
// themselves — the one member the list accounts route accepts without a
// follow.
const isFollowedBy = (
  eb: ExpressionBuilder<DB, 'actors'>,
  followingActorId: string
) =>
  eb.or([
    eb('actors.id', '=', followingActorId),
    eb.exists(
      eb
        .selectFrom('follows')
        .select(sql.lit(1).as('one'))
        .where('follows.actorId', '=', followingActorId)
        .whereRef('follows.targetActorId', '=', 'actors.id')
        .where('follows.status', '=', FollowStatus.enum.Accepted)
    )
  ])

const getExactAccountIds = async ({
  db,
  q,
  localDomain,
  exactActorIds,
  followingActorId
}: {
  db: Db
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
    ? await db
        .selectFrom('actors')
        .select('actors.id')
        .$narrowType<{ id: string }>()
        .where((eb) =>
          eb.and([
            eb(
              eb.fn<string>('lower', ['actors.username']),
              '=',
              exactHandle.username.toLowerCase()
            ),
            eb(
              eb.fn<string>('lower', ['actors.domain']),
              '=',
              exactHandle.domain
            )
          ])
        )
        .execute()
    : []
  const normalizedExactActorIds = [
    ...new Set([...exactActorIds, ...handleActorRows.map((row) => row.id)])
  ]
  if (normalizedExactActorIds.length === 0) return []

  let query = db
    .selectFrom('actors')
    .select('actors.id')
    .where('actors.id', 'in', normalizedExactActorIds)
    .where(isSearchableAccount)
  if (followingActorId) {
    query = query.where((eb) => isFollowedBy(eb, followingActorId))
  }

  const rows = await query.execute()
  const visibleActorIds = new Set(rows.map((row) => row.id))
  return normalizedExactActorIds.filter((id) => visibleActorIds.has(id))
}

const getActorSearchDocumentRow = (
  actor: AccountSearchActor,
  currentTime: Date
): SearchDocumentRow => ({
  id: getSearchDocumentId({
    entityType: 'account',
    entityId: actor.id
  }),
  entityType: 'account',
  entityId: actor.id,
  documentText: getAccountDocumentText(actor),
  actorId: actor.id,
  visibility: null,
  entityCreatedAt:
    actor.createdAt != null
      ? new Date(getCompatibleTime(actor.createdAt))
      : null,
  discoverable: isDiscoverableAccount(actor),
  postCount: null,
  lastPostAt: null,
  createdAt: currentTime,
  updatedAt: currentTime
})

const upsertActorSearchDocuments = async (
  db: Db,
  actors: AccountSearchActor[]
) => {
  if (actors.length === 0) return

  const currentTime = new Date()
  await upsertDocuments(
    db,
    actors.map((actor) => getActorSearchDocumentRow(actor, currentTime))
  )
}

// Passing a fresh actor row indexes that exact shape; passing only an id
// re-reads actors and deletes the search document if the actor row is gone.
export const indexActorSearchDocument = async (
  db: Db,
  { id, actor: providedActor }: { id: string; actor?: AccountSearchActor }
): Promise<void> => {
  const actor =
    providedActor ??
    (await db
      .selectFrom('actors')
      .select(ACTOR_COLUMNS)
      .$narrowType<{ id: string }>()
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst())
  if (!actor) {
    await deleteActorSearchDocument(db, { id })
    return
  }

  await upsertActorSearchDocuments(db, [actor])
}

export const deleteActorSearchDocument = async (
  db: Db,
  { id }: { id: string }
): Promise<void> => {
  await deleteSearchDocument(db, { entityType: 'account', entityId: id })
}

// Exact username and handle matches first, then prefix matches, then the rest.
const orderAccounts = <O>(
  query: SelectQueryBuilder<DB, 'search_documents' | 'actors', O>,
  normalizedQuery: string
) => {
  const username = sql.ref('actors.username')
  const handle = sql`lower(${username} || '@' || ${sql.ref('actors.domain')})`
  const prefix = `${escapeLikePattern(normalizedQuery)}%`

  return query
    .orderBy(
      sql`case
        when ${handle} = ${normalizedQuery} then 0
        when lower(${username}) = ${normalizedQuery} then 1
        when ${handle} like ${prefix} escape '\\' then 2
        when lower(${username}) like ${prefix} escape '\\' then 3
        else 4
      end`
    )
    .orderBy(sql`lower(${username})`)
    .orderBy('search_documents.entityId', 'asc')
}

export const searchAccountIds = async (
  db: Db,
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
    db,
    q,
    localDomain,
    exactActorIds: normalizedExactActorIds,
    followingActorId
  })
  const exactPageIds = exactResultIds.slice(offset, offset + limit)
  const indexedLimit = limit - exactPageIds.length
  if (indexedLimit <= 0) return exactPageIds
  const indexedOffset = Math.max(offset - exactResultIds.length, 0)

  let query = db
    .selectFrom('search_documents')
    .innerJoin('actors', 'actors.id', 'search_documents.entityId')
    .select('search_documents.entityId')
    .where('search_documents.entityType', '=', 'account')
    .where(isSearchableAccount)
  query = matchDocumentText(db, query, q)
  if (exactResultIds.length > 0) {
    query = query.where('search_documents.entityId', 'not in', exactResultIds)
  }
  if (followingActorId) {
    query = query.where((eb) => isFollowedBy(eb, followingActorId))
  } else {
    query = query.where('search_documents.discoverable', '=', true)
  }

  const rows = await orderAccounts(query, normalizedQuery)
    .limit(indexedLimit)
    .offset(indexedOffset)
    .execute()
  return [...exactPageIds, ...rows.map((row) => row.entityId)]
}

export const reindexSearchAccounts = async (
  db: Db,
  { afterId = null, limit = 500 }: ReindexSearchDocumentsParams = {}
): Promise<ReindexSearchDocumentsResult> => {
  // Reindexing walks a snapshot best-effort; normal write paths refresh their
  // own search documents and may temporarily race this batch on live systems.
  let query = db
    .selectFrom('actors')
    .select(ACTOR_COLUMNS)
    .$narrowType<{ id: string }>()
    .orderBy('id', 'asc')
  if (afterId) query = query.where('id', '>', afterId)

  const rows = await query.limit(limit).execute()
  await upsertActorSearchDocuments(db, rows)

  return {
    indexed: rows.length,
    nextCursor: rows.length === limit ? rows[rows.length - 1].id : null
  }
}
