import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { parseStatusContent } from '@/lib/database/sql/utils/parseStatusContent'
import {
  PUBLIC_ACTIVITY_RECIPIENTS,
  applyPotentiallyReadableStatusFilter
} from '@/lib/database/sql/utils/statusVisibility'
import {
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchStatusesParams
} from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

import {
  SEARCH_DOCUMENTS_TABLE,
  applySearchDocumentFilter,
  deleteSearchDocument,
  getSearchDocumentId,
  normalizeSearchText
} from './documents'

type SQLStatusRow = {
  id: string
  actorId: string
  type: string
  content: string | Record<string, unknown> | null
  createdAt: number | Date
}

const SQLITE_MAX_BINDINGS = 999

const getClientName = (database: Knex) => String(database.client.config.client)

const getWhereInBatchSize = (database: Knex) => {
  if (!getClientName(database).includes('sqlite'))
    return Number.POSITIVE_INFINITY
  return SQLITE_MAX_BINDINGS
}

const chunkArray = <T>(items: T[], size: number) => {
  const chunkSize = Number.isFinite(size) ? size : Math.max(items.length, 1)
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize))
  }
  return chunks
}

const getStatusDocumentText = (status: SQLStatusRow) => {
  const content = parseStatusContent(status.content)
  if (!content || typeof content === 'string') return ''

  const text = typeof content.text === 'string' ? content.text : ''
  const summary = typeof content.summary === 'string' ? content.summary : ''
  return normalizeSearchText(
    [htmlToPlainText(text), htmlToPlainText(summary)].join(' ')
  )
}

const getStatusVisibilityFromRecipientIds = (recipientIds: string[]) => {
  if (
    recipientIds.some((actorId) => PUBLIC_ACTIVITY_RECIPIENTS.includes(actorId))
  ) {
    return 'public'
  }
  if (recipientIds.length === 0) return 'direct'
  return 'private'
}

const getStatusRecipientIdsByStatusId = async (
  database: Knex,
  statusIds: string[]
) => {
  const recipientIdsByStatusId = new Map<string, string[]>()
  if (statusIds.length === 0) return recipientIdsByStatusId

  const statusIdChunks = chunkArray(
    [...new Set(statusIds)],
    getWhereInBatchSize(database)
  )

  const rows = (
    await Promise.all(
      statusIdChunks.map((statusIdChunk) =>
        database('recipients')
          .whereIn('statusId', statusIdChunk)
          .select<
            { statusId: string; actorId: string }[]
          >('statusId', 'actorId')
      )
    )
  ).flat()

  for (const row of rows) {
    const recipientIds = recipientIdsByStatusId.get(row.statusId) ?? []
    recipientIds.push(String(row.actorId))
    recipientIdsByStatusId.set(row.statusId, recipientIds)
  }

  return recipientIdsByStatusId
}

const getSearchDocumentInsertBatchSize = (
  database: Knex,
  row: Record<string, unknown>
) => {
  const clientName = getClientName(database)
  if (!clientName.includes('sqlite')) return Number.POSITIVE_INFINITY

  const columnCount = Math.max(1, Object.keys(row).length)
  return Math.max(1, Math.floor(SQLITE_MAX_BINDINGS / columnCount))
}

const deleteStatusSearchDocumentsByStatusIds = async (
  database: Knex,
  statusIds: string[]
) => {
  for (const statusIdChunk of chunkArray(
    statusIds,
    getWhereInBatchSize(database)
  )) {
    await database(SEARCH_DOCUMENTS_TABLE)
      .where('entityType', 'status')
      .whereIn('entityId', statusIdChunk)
      .delete()
  }
}

const reindexStatusSearchDocuments = async (
  database: Knex,
  statuses: SQLStatusRow[]
) => {
  if (statuses.length === 0) return

  const currentTime = new Date()
  const statusIdsToDelete: string[] = []
  const candidates: { status: SQLStatusRow; documentText: string }[] = []

  for (const status of statuses) {
    if (
      status.type !== StatusType.enum.Note &&
      status.type !== StatusType.enum.Poll
    ) {
      statusIdsToDelete.push(status.id)
      continue
    }

    const documentText = getStatusDocumentText(status)
    if (!documentText) {
      statusIdsToDelete.push(status.id)
      continue
    }

    candidates.push({ status, documentText })
  }

  const recipientIdsByStatusId = await getStatusRecipientIdsByStatusId(
    database,
    candidates.map(({ status }) => status.id)
  )
  const rows = candidates.map(({ status, documentText }) => ({
    id: getSearchDocumentId({
      entityType: 'status',
      entityId: status.id
    }),
    entityType: 'status',
    entityId: status.id,
    documentText,
    actorId: status.actorId,
    visibility: getStatusVisibilityFromRecipientIds(
      recipientIdsByStatusId.get(status.id) ?? []
    ),
    entityCreatedAt: new Date(getCompatibleTime(status.createdAt)),
    discoverable: null,
    postCount: null,
    lastPostAt: null,
    createdAt: currentTime,
    updatedAt: currentTime
  }))

  if (statusIdsToDelete.length > 0) {
    await deleteStatusSearchDocumentsByStatusIds(database, statusIdsToDelete)
  }

  if (rows.length === 0) return

  const batchSize = getSearchDocumentInsertBatchSize(database, rows[0])
  for (let start = 0; start < rows.length; start += batchSize) {
    await database(SEARCH_DOCUMENTS_TABLE)
      .insert(rows.slice(start, start + batchSize))
      .onConflict(['entityType', 'entityId'])
      .merge([
        'documentText',
        'actorId',
        'visibility',
        'entityCreatedAt',
        'updatedAt'
      ])
  }
}

export const indexStatusSearchDocument = async (
  database: Knex,
  { statusId }: { statusId: string }
): Promise<void> => {
  const status = await database<SQLStatusRow>('statuses')
    .where('id', statusId)
    .first()
  if (!status) {
    await deleteStatusSearchDocument(database, { statusId })
    return
  }

  await reindexStatusSearchDocuments(database, [status])
}

export const deleteStatusSearchDocument = async (
  database: Knex,
  { statusId }: { statusId: string }
): Promise<void> => {
  await deleteSearchDocument(database, {
    entityType: 'status',
    entityId: statusId
  })
}

const applyCursorFilter = async ({
  database,
  query,
  maxId,
  minId
}: {
  database: Knex
  query: Knex.QueryBuilder
  maxId?: string | null
  minId?: string | null
}) => {
  const cursorIds = [
    ...new Set([maxId, minId].filter((id): id is string => Boolean(id)))
  ]
  const cursors = new Map<
    string,
    { entityCreatedAt: number | Date; entityId: string }
  >()

  if (cursorIds.length > 0) {
    const rows = await database(SEARCH_DOCUMENTS_TABLE)
      .where('entityType', 'status')
      .whereIn('entityId', cursorIds)
      .select<
        { entityCreatedAt: number | Date; entityId: string }[]
      >('entityCreatedAt', 'entityId')
    for (const row of rows) {
      cursors.set(row.entityId, row)
    }
  }

  if (maxId) {
    const cursor = cursors.get(maxId)
    if (cursor) {
      query.where((builder) => {
        builder
          .where(
            'search_documents.entityCreatedAt',
            '<',
            cursor.entityCreatedAt
          )
          .orWhere((sameTimeBuilder) => {
            sameTimeBuilder
              .where('search_documents.entityCreatedAt', cursor.entityCreatedAt)
              .where('search_documents.entityId', '<', cursor.entityId)
          })
      })
    }
  }

  if (minId) {
    const cursor = cursors.get(minId)
    if (cursor) {
      query.where((builder) => {
        builder
          .where(
            'search_documents.entityCreatedAt',
            '>',
            cursor.entityCreatedAt
          )
          .orWhere((sameTimeBuilder) => {
            sameTimeBuilder
              .where('search_documents.entityCreatedAt', cursor.entityCreatedAt)
              .where('search_documents.entityId', '>', cursor.entityId)
          })
      })
    }
  }
}

const getMentionSearchValues = async (
  database: Knex,
  {
    currentActorId,
    currentActorUsername,
    currentActorDomain
  }: Pick<
    SearchStatusesParams,
    'currentActorId' | 'currentActorUsername' | 'currentActorDomain'
  >
) => {
  if (currentActorUsername && currentActorDomain) {
    return [
      currentActorId,
      `https://${currentActorDomain}/@${currentActorUsername}`,
      `https://${currentActorDomain}/@${currentActorUsername}@${currentActorDomain}`
    ]
  }

  const actor = await database('actors')
    .where('id', currentActorId)
    .first<{ username: string; domain: string }>('username', 'domain')
  if (!actor) return [currentActorId]

  return [
    currentActorId,
    `https://${actor.domain}/@${actor.username}`,
    `https://${actor.domain}/@${actor.username}@${actor.domain}`
  ]
}

const applyRestrictiveStatusSearchPolicy = ({
  database,
  query,
  currentActorId,
  mentionValues
}: {
  database: Knex
  query: Knex.QueryBuilder
  currentActorId: string
  mentionValues: string[]
}) => {
  query.where((builder) => {
    builder
      .where('statuses.actorId', currentActorId)
      .orWhereExists(function () {
        this.select(database.raw('1'))
          .from('likes')
          .where('likes.actorId', currentActorId)
          .whereRaw('?? = ??', ['likes.statusId', 'statuses.id'])
      })
      .orWhereExists(function () {
        this.select(database.raw('1'))
          .from('bookmarks')
          .where('bookmarks.actorId', currentActorId)
          .whereRaw('?? = ??', ['bookmarks.statusId', 'statuses.id'])
      })
      .orWhereExists(function () {
        this.select(database.raw('1'))
          .from('tags')
          .where('tags.type', 'mention')
          .whereRaw('?? = ??', ['tags.statusId', 'statuses.id'])
          .whereIn('tags.value', mentionValues)
      })
  })
}

const applyBlockedAccountFilter = ({
  database,
  query,
  currentActorId
}: {
  database: Knex
  query: Knex.QueryBuilder
  currentActorId: string
}) => {
  query.whereNotExists(function () {
    this.select(database.raw('1'))
      .from('blocks')
      .where((builder) => {
        builder
          .where((outgoing) => {
            outgoing
              .where('blocks.actorId', currentActorId)
              .whereRaw('?? = ??', ['blocks.targetActorId', 'statuses.actorId'])
          })
          .orWhere((incoming) => {
            incoming
              .where('blocks.targetActorId', currentActorId)
              .whereRaw('?? = ??', ['blocks.actorId', 'statuses.actorId'])
          })
      })
  })
}

const applyStatusReindexCursor = async ({
  database,
  query,
  afterId
}: {
  database: Knex
  query: Knex.QueryBuilder
  afterId: string | null
}) => {
  if (!afterId) return

  const cursor = await database<SQLStatusRow>('statuses')
    .where('id', afterId)
    .first('id', 'createdAt')

  if (!cursor) {
    query.where('id', '>', afterId)
    return
  }

  query.where((builder) => {
    builder
      .where('createdAt', '>', cursor.createdAt)
      .orWhere((sameTimeBuilder) => {
        sameTimeBuilder
          .where('createdAt', cursor.createdAt)
          .where('id', '>', cursor.id)
      })
  })
}

export const searchStatusIds = async (
  database: Knex,
  {
    q,
    limit,
    offset = 0,
    currentActorId,
    currentActorUsername,
    currentActorDomain,
    accountId,
    minId,
    maxId
  }: SearchStatusesParams
): Promise<string[]> => {
  const mentionValues = await getMentionSearchValues(database, {
    currentActorId,
    currentActorUsername,
    currentActorDomain
  })
  const query = database(SEARCH_DOCUMENTS_TABLE)
    .innerJoin('statuses', 'statuses.id', 'search_documents.entityId')
    .select<{ entityId: string }[]>('search_documents.entityId')
    .where('search_documents.entityType', 'status')
    .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])

  await applySearchDocumentFilter({ database, query, q })
  if (accountId) query.where('statuses.actorId', accountId)

  applyPotentiallyReadableStatusFilter({
    database,
    query,
    visibleToActorId: currentActorId
  })
  applyRestrictiveStatusSearchPolicy({
    database,
    query,
    currentActorId,
    mentionValues
  })
  applyBlockedAccountFilter({ database, query, currentActorId })
  await applyCursorFilter({ database, query, maxId, minId })

  const rows = await query
    .orderBy('search_documents.entityCreatedAt', 'desc')
    .orderBy('search_documents.entityId', 'desc')
    .limit(limit)
    .offset(offset)

  return rows.map((row) => row.entityId)
}

export const reindexSearchStatuses = async (
  database: Knex,
  { afterId = null, limit = 500 }: ReindexSearchDocumentsParams = {}
): Promise<ReindexSearchDocumentsResult> => {
  const query = database<SQLStatusRow>('statuses')
    .select('id', 'actorId', 'type', 'content', 'createdAt')
    .whereIn('type', [StatusType.enum.Note, StatusType.enum.Poll])
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')

  await applyStatusReindexCursor({ database, query, afterId })

  const rows = await query.limit(limit)
  await reindexStatusSearchDocuments(database, rows)

  return {
    indexed: rows.length,
    nextCursor: rows.length === limit ? rows[rows.length - 1].id : null
  }
}
