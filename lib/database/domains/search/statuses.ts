import { type NotNull, sql } from 'kysely'

import {
  deleteSearchDocument,
  matchDocumentText
} from '@/lib/database/domains/search/documents'
import {
  getSearchDocumentId,
  normalizeSearchText
} from '@/lib/database/domains/search/rows'
import type {
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchStatusesParams
} from '@/lib/database/domains/search/types'
import type { Db } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'
import {
  getWhereInBatchSize,
  insertInChunks,
  selectInChunks
} from '@/lib/database/kysely/inList'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import {
  PUBLIC_ACTIVITY_RECIPIENTS,
  potentiallyReadableStatus
} from '@/lib/database/kysely/visibility/potentiallyReadable'
import { chunkArray } from '@/lib/database/sql/utils/knex'
import { parseStatusContent } from '@/lib/database/sql/utils/parseStatusContent'
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

// A status as the search index reads it. Callers inside a Knex transaction
// hand over the row they just wrote, with `createdAt` a Date.
export type StatusSearchRow = {
  id: string
  actorId: string
  type: string
  content: string | Record<string, unknown> | null
  createdAt: number | Date
}

type IndexStatusSearchDocumentParams =
  { statusId: string } | { status: StatusSearchRow }

type StatusCursor = { id: string; createdAt: number }

const STATUS_COLUMNS = [
  'id',
  'actorId',
  'type',
  'content',
  'createdAt'
] as const
const STATUS_REINDEX_CURSOR_PREFIX = 'status-created-at:'
const SEARCHABLE_STATUS_TYPES: string[] = [
  StatusType.enum.Note,
  StatusType.enum.Poll
]

const selectSearchStatuses = (db: Db) =>
  db
    .selectFrom('statuses')
    .select(STATUS_COLUMNS)
    .$narrowType<{ actorId: NotNull; type: NotNull; createdAt: NotNull }>()

const getStatusDocumentText = (status: StatusSearchRow) => {
  const content = parseStatusContent(status.content)
  if (!content) return ''
  if (typeof content === 'string')
    return normalizeSearchText(htmlToPlainText(content))

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

const getStatusRecipientIdsByStatusId = async (db: Db, statusIds: string[]) => {
  const rows = await selectInChunks(db, [...new Set(statusIds)], (chunk) =>
    db
      .selectFrom('recipients')
      .select(['statusId', 'actorId'])
      .where('statusId', 'in', chunk)
      .execute()
  )
  const recipientIdsByStatusId = new Map<string, string[]>()
  for (const row of rows) {
    const statusId = String(row.statusId)
    const recipientIds = recipientIdsByStatusId.get(statusId) ?? []
    recipientIds.push(String(row.actorId))
    recipientIdsByStatusId.set(statusId, recipientIds)
  }
  return recipientIdsByStatusId
}

export const deleteStatusSearchDocumentsByStatusIds = async (
  db: Db,
  statusIds: string[]
) => {
  for (const statusIdChunk of chunkArray(
    statusIds,
    getWhereInBatchSize(db, 1)
  )) {
    await db
      .deleteFrom('search_documents')
      .where('entityType', '=', 'status')
      .where('entityId', 'in', statusIdChunk)
      .execute()
  }
}

const reindexStatusSearchDocuments = async (
  db: Db,
  statuses: StatusSearchRow[]
) => {
  if (statuses.length === 0) return

  const currentTime = new Date()
  const statusIdsToDelete: string[] = []
  const candidates: { status: StatusSearchRow; documentText: string }[] = []

  for (const status of statuses) {
    const documentText = SEARCHABLE_STATUS_TYPES.includes(status.type)
      ? getStatusDocumentText(status)
      : ''
    if (!documentText) {
      statusIdsToDelete.push(status.id)
      continue
    }
    candidates.push({ status, documentText })
  }

  const recipientIdsByStatusId = await getStatusRecipientIdsByStatusId(
    db,
    candidates.map(({ status }) => status.id)
  )
  const rows = candidates.map(({ status, documentText }) => ({
    id: getSearchDocumentId({ entityType: 'status', entityId: status.id }),
    entityType: 'status',
    entityId: status.id,
    documentText,
    actorId: status.actorId,
    visibility: getStatusVisibilityFromRecipientIds(
      recipientIdsByStatusId.get(status.id) ?? []
    ),
    entityCreatedAt: new Date(status.createdAt),
    discoverable: null,
    postCount: null,
    lastPostAt: null,
    createdAt: currentTime,
    updatedAt: currentTime
  }))

  await deleteStatusSearchDocumentsByStatusIds(db, statusIdsToDelete)
  await insertInChunks(db, rows, (chunk) =>
    db
      .insertInto('search_documents')
      .values(chunk)
      .onConflict((oc) =>
        oc.column('id').doUpdateSet((eb) => ({
          documentText: eb.ref('excluded.documentText'),
          actorId: eb.ref('excluded.actorId'),
          visibility: eb.ref('excluded.visibility'),
          entityCreatedAt: eb.ref('excluded.entityCreatedAt'),
          updatedAt: eb.ref('excluded.updatedAt')
        }))
      )
      .execute()
  )
}

// Passing a fresh status row indexes that exact shape; passing only an id
// re-reads statuses and deletes the search document if the status is gone.
export const indexStatusSearchDocument = async (
  db: Db,
  params: IndexStatusSearchDocumentParams
): Promise<void> => {
  if ('status' in params) {
    await reindexStatusSearchDocuments(db, [params.status])
    return
  }

  const status = await selectSearchStatuses(db)
    .where('id', '=', params.statusId)
    .executeTakeFirst()
  if (!status) {
    await deleteStatusSearchDocument(db, { statusId: params.statusId })
    return
  }

  await reindexStatusSearchDocuments(db, [status])
}

export const deleteStatusSearchDocument = (
  db: Db,
  { statusId }: { statusId: string }
): Promise<void> =>
  deleteSearchDocument(db, { entityType: 'status', entityId: statusId })

// The (createdAt, id) position of each paging cursor: its search document, or
// the status itself when the document is gone.
const getStatusCursors = async (db: Db, statusIds: string[]) => {
  const cursors = new Map<string, StatusCursor>()
  if (statusIds.length === 0) return cursors

  const documents = await db
    .selectFrom('search_documents')
    .select(['entityId', 'entityCreatedAt'])
    .where('entityType', '=', 'status')
    .where('entityId', 'in', statusIds)
    .execute()
  for (const { entityId, entityCreatedAt } of documents) {
    if (entityCreatedAt === null) continue
    cursors.set(entityId, { id: entityId, createdAt: entityCreatedAt })
  }

  const missingIds = statusIds.filter((id) => !cursors.has(id))
  if (missingIds.length > 0) {
    const statuses = await db
      .selectFrom('statuses')
      .select(['id', 'createdAt'])
      .where('id', 'in', missingIds)
      .execute()
    for (const { id, createdAt } of statuses) {
      if (createdAt === null) continue
      cursors.set(id, { id, createdAt })
    }
  }
  return cursors
}

const getMentionSearchValues = async (
  db: Db,
  {
    currentActorId,
    currentActorUsername,
    currentActorDomain
  }: Pick<
    SearchStatusesParams,
    'currentActorId' | 'currentActorUsername' | 'currentActorDomain'
  >
) => {
  const normalizeMentionValues = (values: string[]) => [
    ...new Set(
      values.filter(Boolean).flatMap((value) => {
        const normalizedValue = normalizeActorId(value)
        return normalizedValue ? [value, normalizedValue] : [value]
      })
    )
  ]
  const handleValues = (username: string | null, domain: string | null) => [
    currentActorId,
    `@${username}`,
    `@${username}@${domain}`,
    `https://${domain}/@${username}`,
    `https://${domain}/@${username}@${domain}`
  ]

  if (currentActorUsername && currentActorDomain) {
    return normalizeMentionValues(
      handleValues(currentActorUsername, currentActorDomain)
    )
  }

  const actor = await db
    .selectFrom('actors')
    .select(['username', 'domain'])
    .where('id', '=', normalizeActorId(currentActorId) ?? currentActorId)
    .executeTakeFirst()
  if (!actor) return normalizeMentionValues([currentActorId])
  return normalizeMentionValues(handleValues(actor.username, actor.domain))
}

export const searchStatusIds = async (
  db: Db,
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
  const viewerId = normalizeActorId(currentActorId) ?? currentActorId
  const mentionValues = await getMentionSearchValues(db, {
    currentActorId,
    currentActorUsername,
    currentActorDomain
  })
  const cursors = await getStatusCursors(db, [
    ...new Set([maxId, minId].filter((id): id is string => Boolean(id)))
  ])

  let query = db
    .selectFrom('search_documents')
    .innerJoin('statuses', 'statuses.id', 'search_documents.entityId')
    .select('search_documents.entityId')
    .where('search_documents.entityType', '=', 'status')
    .where('statuses.type', 'in', SEARCHABLE_STATUS_TYPES)
  query = matchDocumentText(db, query, q)
  if (accountId) query = query.where('statuses.actorId', '=', accountId)
  query = query
    .where((eb) => potentiallyReadableStatus(db, eb, viewerId))
    // Search finds only statuses the viewer wrote, liked, bookmarked or was
    // mentioned in.
    .where((eb) =>
      eb.or([
        eb('statuses.actorId', '=', viewerId),
        eb.exists(
          eb
            .selectFrom('likes')
            .select(sql.lit(1).as('one'))
            .where('likes.actorId', '=', viewerId)
            .whereRef('likes.statusId', '=', 'statuses.id')
        ),
        eb.exists(
          eb
            .selectFrom('bookmarks')
            .select(sql.lit(1).as('one'))
            .where('bookmarks.actorId', '=', viewerId)
            .whereRef('bookmarks.statusId', '=', 'statuses.id')
        ),
        ...(mentionValues.length > 0
          ? [
              eb.exists(
                eb
                  .selectFrom('tags')
                  .select(sql.lit(1).as('one'))
                  .where('tags.type', '=', 'mention')
                  .whereRef('tags.statusId', '=', 'statuses.id')
                  .where((mention) =>
                    mention.or([
                      mention('tags.value', 'in', mentionValues),
                      mention('tags.name', 'in', mentionValues)
                    ])
                  )
              )
            ]
          : [])
      ])
    )
    // Neither side of a block sees the other's statuses.
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('blocks')
            .select(sql.lit(1).as('one'))
            .where((block) =>
              block.or([
                block.and([
                  block('blocks.actorId', '=', viewerId),
                  block(
                    'blocks.targetActorId',
                    '=',
                    block.ref('statuses.actorId')
                  )
                ]),
                block.and([
                  block('blocks.targetActorId', '=', viewerId),
                  block('blocks.actorId', '=', block.ref('statuses.actorId'))
                ])
              ])
            )
        )
      )
    )

  for (const [cursorId, operator] of [
    [maxId, '<'],
    [minId, '>']
  ] as const) {
    if (!cursorId) continue
    const cursor = cursors.get(cursorId)
    if (!cursor) {
      query = query.where(sql<boolean>`1 = 0`)
      continue
    }
    const createdAt = timestampValue(cursor.createdAt)
    query = query.where((eb) =>
      eb.or([
        eb('search_documents.entityCreatedAt', operator, createdAt),
        eb.and([
          eb('search_documents.entityCreatedAt', '=', createdAt),
          eb('search_documents.entityId', operator, cursor.id)
        ])
      ])
    )
  }

  const rows = await query
    .orderBy('search_documents.entityCreatedAt', 'desc')
    .orderBy('search_documents.entityId', 'desc')
    .limit(limit)
    .offset(offset)
    .execute()
  return rows.map((row) => row.entityId)
}

const parseStatusReindexCursor = (cursor: string): StatusCursor | null => {
  if (!cursor.startsWith(STATUS_REINDEX_CURSOR_PREFIX)) return null

  const payload = cursor.slice(STATUS_REINDEX_CURSOR_PREFIX.length)
  const separatorIndex = payload.indexOf(':')
  if (separatorIndex < 1) return null

  const createdAt = Number(payload.slice(0, separatorIndex))
  if (!Number.isFinite(createdAt)) return null

  try {
    return {
      createdAt,
      id: decodeURIComponent(payload.slice(separatorIndex + 1))
    }
  } catch {
    return null
  }
}

// An encoded cursor, else the status with that id, else its search document.
const findStatusReindexCursor = async (
  db: Db,
  afterId: string
): Promise<StatusCursor | null> => {
  const parsed = parseStatusReindexCursor(afterId)
  if (parsed) return parsed

  const status = await db
    .selectFrom('statuses')
    .select(['id', 'createdAt'])
    .where('id', '=', afterId)
    .executeTakeFirst()
  if (status?.createdAt != null) {
    return { id: status.id, createdAt: status.createdAt }
  }

  const document = await db
    .selectFrom('search_documents')
    .select(['entityId', 'entityCreatedAt'])
    .where('entityType', '=', 'status')
    .where('entityId', '=', afterId)
    .executeTakeFirst()
  if (document?.entityCreatedAt != null) {
    return { id: document.entityId, createdAt: document.entityCreatedAt }
  }
  return null
}

const getStatusReindexCursor = (status: { id: string; createdAt: number }) =>
  `${STATUS_REINDEX_CURSOR_PREFIX}${status.createdAt}:${encodeURIComponent(status.id)}`

export const reindexSearchStatuses = async (
  db: Db,
  { afterId = null, limit = 500 }: ReindexSearchDocumentsParams = {}
): Promise<ReindexSearchDocumentsResult> => {
  let query = selectSearchStatuses(db)
    .where('type', 'in', SEARCHABLE_STATUS_TYPES)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
  if (afterId) {
    const cursor = await findStatusReindexCursor(db, afterId)
    query = cursor
      ? query.where((eb) =>
          pastKeyset(
            eb,
            { createdAt: cursor.createdAt, tieBreaker: cursor.id },
            '>',
            'id'
          )
        )
      : query.where(sql<boolean>`1 = 0`)
  }

  const rows = await query.limit(limit).execute()
  await reindexStatusSearchDocuments(db, rows)

  return {
    indexed: rows.length,
    nextCursor:
      rows.length === limit
        ? getStatusReindexCursor(rows[rows.length - 1])
        : null
  }
}
