import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchAccountsParams
} from '@/lib/types/database/operations'
import { SQLActor } from '@/lib/types/database/rows'
import { FollowStatus } from '@/lib/types/domain/follow'

import {
  SEARCH_DOCUMENTS_TABLE,
  applySearchDocumentFilter,
  deleteSearchDocument,
  normalizeSearchText,
  upsertSearchDocument
} from './documents'

const parseAccountHandle = (value: string) => {
  const normalized = value.trim().replace(/^@/, '').toLowerCase()
  const [username, domain, ...rest] = normalized.split('@')
  if (!username || !domain || rest.length > 0) return null
  return { username, domain }
}

const getAccountDocumentText = (actor: SQLActor) => {
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

const isDiscoverableAccount = (actor: SQLActor) => {
  const settings = getCompatibleJSON<Record<string, unknown>>(
    actor.settings as string | Record<string, unknown>
  )
  return settings.noindex !== true && actor.deletionStatus !== 'deleting'
}

const getLowerAccountHandleSQL = (database: Knex) => {
  const clientName = String(database.client.config.client)
  if (clientName.includes('mysql')) {
    return "LOWER(CONCAT(??, '@', ??))"
  }
  return "LOWER(?? || '@' || ??)"
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

  query
    .orderByRaw(
      `case
        when ${lowerHandleSQL} = ? then 0
        when lower(??) = ? then 1
        when ${lowerHandleSQL} like ? then 2
        when lower(??) like ? then 3
        else 4
      end`,
      [
        'actors.username',
        'actors.domain',
        normalizedQuery,
        'actors.username',
        normalizedQuery,
        'actors.username',
        'actors.domain',
        `${normalizedQuery}%`,
        'actors.username',
        `${normalizedQuery}%`
      ]
    )
    .orderByRaw('LOWER(??)', ['actors.username'])
    .orderBy('search_documents.entityId', 'asc')
}

export const indexActorSearchDocument = async (
  database: Knex,
  { id }: { id: string }
): Promise<void> => {
  const actor = await database<SQLActor>('actors').where('id', id).first()
  if (!actor) {
    await deleteActorSearchDocument(database, { id })
    return
  }

  await upsertSearchDocument(database, {
    entityType: 'account',
    entityId: actor.id,
    documentText: getAccountDocumentText(actor),
    actorId: actor.id,
    entityCreatedAt: getCompatibleTime(actor.createdAt),
    discoverable: isDiscoverableAccount(actor)
  })
}

export const searchAccountIds = async (
  database: Knex,
  { q, limit, offset = 0, followingActorId }: SearchAccountsParams
): Promise<string[]> => {
  const handle = parseAccountHandle(q)
  const normalizedQuery = q.trim().replace(/^@/, '').toLowerCase()
  const query = database(SEARCH_DOCUMENTS_TABLE)
    .innerJoin('actors', 'actors.id', 'search_documents.entityId')
    .select<{ entityId: string }[]>('search_documents.entityId')
    .where('search_documents.entityType', 'account')

  await applySearchDocumentFilter({ database, query, q })

  query.where((builder) => {
    builder.where('search_documents.discoverable', true)
    if (handle) {
      builder.orWhere((exactBuilder) => {
        exactBuilder
          .whereRaw('LOWER(??) = ?', ['actors.username', handle.username])
          .whereRaw('LOWER(??) = ?', ['actors.domain', handle.domain])
      })
    }
  })

  if (followingActorId) {
    query.whereExists(function () {
      this.select(database.raw('1'))
        .from('follows')
        .where('follows.actorId', followingActorId)
        .whereRaw('?? = ??', ['follows.targetActorId', 'actors.id'])
        .where('follows.status', FollowStatus.enum.Accepted)
    })
  }

  applyAccountOrdering({ database, query, normalizedQuery })

  const rows = await query.limit(limit).offset(offset)
  return rows.map((row) => row.entityId)
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
  const query = database<SQLActor>('actors').select('id').orderBy('id', 'asc')
  if (afterId) query.where('id', '>', afterId)

  const rows = await query.limit(limit)
  for (const row of rows) {
    await indexActorSearchDocument(database, { id: row.id })
  }

  return {
    indexed: rows.length,
    nextCursor: rows.length === limit ? rows[rows.length - 1].id : null
  }
}
