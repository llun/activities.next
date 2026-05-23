import { Knex } from 'knex'
import sanitizeHtml from 'sanitize-html'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { applyPotentiallyReadableStatusFilter } from '@/lib/database/sql/utils/statusVisibility'
import {
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchStatusesParams
} from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

import {
  SEARCH_DOCUMENTS_TABLE,
  applySearchDocumentFilter,
  deleteSearchDocument,
  normalizeSearchText,
  upsertSearchDocument
} from './documents'

type SQLStatusRow = {
  id: string
  actorId: string
  type: string
  content: string | Record<string, unknown> | null
  createdAt: number | Date
}

const parseStatusContent = (
  content: SQLStatusRow['content']
): Record<string, unknown> | string | null => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      return getCompatibleJSON(content)
    } catch {
      return content
    }
  }
  return content
}

const stripHTML = (value: string) =>
  sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {}
  })

const getStatusDocumentText = (status: SQLStatusRow) => {
  const content = parseStatusContent(status.content)
  if (!content || typeof content === 'string') return ''

  const text = typeof content.text === 'string' ? content.text : ''
  const summary = typeof content.summary === 'string' ? content.summary : ''
  return normalizeSearchText([stripHTML(text), stripHTML(summary)].join(' '))
}

const getStatusVisibility = async (database: Knex, statusId: string) => {
  const recipients = await database('recipients').where('statusId', statusId)
  const recipientIds = recipients.map((recipient) => String(recipient.actorId))
  if (
    recipientIds.some((actorId) =>
      [ACTIVITY_STREAM_PUBLIC, ACTIVITY_STREAM_PUBLIC_COMPACT].includes(actorId)
    )
  ) {
    return 'public'
  }
  if (recipientIds.length === 0) return 'direct'
  return 'private'
}

export const indexStatusSearchDocument = async (
  database: Knex,
  { statusId }: { statusId: string }
): Promise<void> => {
  const status = await database<SQLStatusRow>('statuses')
    .where('id', statusId)
    .first()
  if (
    !status ||
    (status.type !== StatusType.enum.Note &&
      status.type !== StatusType.enum.Poll)
  ) {
    await deleteStatusSearchDocument(database, { statusId })
    return
  }

  const documentText = getStatusDocumentText(status)
  if (!documentText) {
    await deleteStatusSearchDocument(database, { statusId })
    return
  }

  await upsertSearchDocument(database, {
    entityType: 'status',
    entityId: status.id,
    documentText,
    actorId: status.actorId,
    visibility: await getStatusVisibility(database, status.id),
    entityCreatedAt: getCompatibleTime(status.createdAt)
  })
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
  if (maxId) {
    const cursor = await database(SEARCH_DOCUMENTS_TABLE)
      .where({ entityType: 'status', entityId: maxId })
      .first<{ entityCreatedAt: number | Date; entityId: string }>()
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
    const cursor = await database(SEARCH_DOCUMENTS_TABLE)
      .where({ entityType: 'status', entityId: minId })
      .first<{ entityCreatedAt: number | Date; entityId: string }>()
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
  currentActorId: string
) => {
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

export const searchStatusIds = async (
  database: Knex,
  {
    q,
    limit,
    offset = 0,
    currentActorId,
    accountId,
    minId,
    maxId
  }: SearchStatusesParams
): Promise<string[]> => {
  const mentionValues = await getMentionSearchValues(database, currentActorId)
  const query = database(SEARCH_DOCUMENTS_TABLE)
    .innerJoin('statuses', 'statuses.id', 'search_documents.entityId')
    .select<{ entityId: string }[]>('search_documents.entityId')
    .where('search_documents.entityType', 'status')
    .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])

  applySearchDocumentFilter({ database, query, q })
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
    .select('id')
    .whereIn('type', [StatusType.enum.Note, StatusType.enum.Poll])
    .orderBy('id', 'asc')

  if (afterId) query.where('id', '>', afterId)

  const rows = await query.limit(limit)
  await Promise.all(
    rows.map((row) => indexStatusSearchDocument(database, { statusId: row.id }))
  )

  return {
    indexed: rows.length,
    nextCursor: rows.length === limit ? rows[rows.length - 1].id : null
  }
}
