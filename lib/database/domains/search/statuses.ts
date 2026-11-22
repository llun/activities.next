import {
  type Expression,
  type ExpressionBuilder,
  type NotNull,
  type SqlBool,
  sql
} from 'kysely'

import { deleteSearchDocument } from '@/lib/database/domains/search/documents'
import {
  getSearchDocumentId,
  normalizeSearchText
} from '@/lib/database/domains/search/rows'
import type {
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchStatusesParams
} from '@/lib/database/domains/search/types'
import type { DB, Db } from '@/lib/database/kysely'
import {
  fullTextQueryMatch,
  timestampValue
} from '@/lib/database/kysely/dialect'
import {
  chunkArray,
  getWhereInBatchSize,
  insertInChunks,
  selectInChunks
} from '@/lib/database/kysely/inList'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import {
  PUBLIC_ACTIVITY_RECIPIENTS,
  potentiallyReadableStatus
} from '@/lib/database/kysely/visibility/potentiallyReadable'
import { parseStatusContent } from '@/lib/database/utils/parseStatusContent'
import {
  formatActivityTypeLabel,
  getActivityPresentation
} from '@/lib/services/fitness-files/activityPresentation'
import {
  type SearchFilter,
  getSearchDayEnd,
  parseSearchQuery
} from '@/lib/services/search/parseSearchQuery'
import {
  isAudibleAttachment,
  isFitnessAttachment,
  isVisualAttachment
} from '@/lib/types/domain/attachment'
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// A status as the search index reads it. Callers inside a transaction hand
// over the row they just wrote, with `createdAt` a Date.
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

const getStatusDocumentText = (
  status: StatusSearchRow,
  extraText: string[] = []
) => {
  const content = parseStatusContent(status.content)
  const text =
    typeof content === 'string'
      ? htmlToPlainText(content)
      : content
        ? [content.text, content.summary]
            .map((value) => (typeof value === 'string' ? value : ''))
            .map(htmlToPlainText)
            .join(' ')
        : ''
  return normalizeSearchText([text, ...extraText].join(' '))
}

// What else a status shows every reader, beside its text: the alt text of each
// attachment, the species a posted photo names, the poll's options, and the
// type and description of the activity the post shows (the first non-deleted
// recording, primary first, as hydration picks it). Never a photo's place or
// anything else its owner may withhold from viewers (hidden locations,
// threatened species' places); the subject itself is public, as
// `toSubjectEntity` serves it. The route map attachment is skipped: its alt
// text is a fixed label.
const getStatusExtraTextByStatusId = async (
  db: Db,
  statuses: Pick<StatusSearchRow, 'id' | 'type'>[]
) => {
  const extraTextByStatusId = new Map<string, string[]>()
  const statusIds = [...new Set(statuses.map((status) => status.id))]
  if (statusIds.length === 0) return extraTextByStatusId
  // Only a Poll has choices, and `poll_choices.statusId` has no index.
  const pollIds = [
    ...new Set(
      statuses
        .filter((status) => status.type === StatusType.enum.Poll)
        .map((status) => status.id)
    )
  ]
  const append = (statusId: string | null, values: (string | null)[]) => {
    if (!statusId) return
    const texts = extraTextByStatusId.get(statusId) ?? []
    for (const value of values) if (value) texts.push(value)
    extraTextByStatusId.set(statusId, texts)
  }

  // One after another: inside a transaction they share one connection.
  const attachments = await selectInChunks(
    db,
    statusIds,
    (chunk) =>
      db
        .selectFrom('attachments')
        // A photo's subject counts only when the media's owner (or another
        // actor of their account) attached it, as the public details route
        // decides: `attachments.mediaId` alone is a pointer anyone could
        // write.
        .leftJoin('actors as attachmentActors', (join) =>
          join.onRef('attachmentActors.id', '=', 'attachments.actorId')
        )
        .leftJoin('medias', (join) =>
          join
            .onRef('medias.id', '=', 'attachments.mediaId')
            .on((eb) =>
              eb.or([
                eb('medias.actorId', '=', eb.ref('attachments.actorId')),
                eb.exists(
                  eb
                    .selectFrom('actors as mediaActors')
                    .select(sql.lit(1).as('one'))
                    .whereRef('mediaActors.id', '=', 'medias.actorId')
                    .where('mediaActors.accountId', 'is not', null)
                    .whereRef(
                      'mediaActors.accountId',
                      '=',
                      'attachmentActors.accountId'
                    )
                )
              ])
            )
        )
        .select([
          'attachments.statusId',
          'attachments.name',
          'attachments.mediaType',
          'attachments.url',
          'medias.subjectName',
          'medias.subjectScientificName',
          'medias.subjectCategory'
        ])
        .where('attachments.statusId', 'in', chunk)
        .where('attachments.isRouteMap', '=', false)
        .orderBy('attachments.createdAt', 'asc')
        .orderBy('attachments.id', 'asc')
        .execute(),
    1
  )
  const choices = await selectInChunks(db, pollIds, (chunk) =>
    db
      .selectFrom('poll_choices')
      .select(['statusId', 'title'])
      .where('statusId', 'in', chunk)
      .orderBy('choiceId', 'asc')
      .execute()
  )
  const fitnessFiles = await selectInChunks(db, statusIds, (chunk) =>
    db
      .selectFrom('fitness_files')
      .select(['statusId', 'activityType', 'description'])
      .where('statusId', 'in', chunk)
      .where('deletedAt', 'is', null)
      .orderBy('isPrimary', 'desc')
      .orderBy('activityStartTime', 'asc')
      .orderBy('createdAt', 'asc')
      .execute()
  )

  for (const row of attachments) {
    // A remote note's activity file rides along as an attachment the post
    // never shows. `isFitnessAttachment` also matches on the alt text, so a
    // photo or clip the post does show is never skipped by it.
    const attachment = {
      mediaType: row.mediaType ?? '',
      url: row.url ?? '',
      name: row.name ?? ''
    }
    if (
      !isVisualAttachment(attachment) &&
      !isAudibleAttachment(attachment) &&
      isFitnessAttachment(attachment)
    ) {
      continue
    }
    append(row.statusId, [
      row.name,
      row.subjectName,
      row.subjectScientificName,
      row.subjectCategory
    ])
  }
  for (const row of choices) append(row.statusId, [row.title])
  const seenFitnessStatusIds = new Set<string>()
  for (const row of fitnessFiles) {
    if (!row.statusId || seenFitnessStatusIds.has(row.statusId)) continue
    seenFitnessStatusIds.add(row.statusId)
    append(row.statusId, [
      ...(row.activityType
        ? [
            formatActivityTypeLabel(row.activityType),
            getActivityPresentation(row.activityType).label
          ]
        : []),
      row.description
    ])
  }
  return extraTextByStatusId
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
  const extraTextByStatusId = await getStatusExtraTextByStatusId(
    db,
    statuses.filter((status) => SEARCHABLE_STATUS_TYPES.includes(status.type))
  )

  for (const status of statuses) {
    if (!SEARCHABLE_STATUS_TYPES.includes(status.type)) {
      statusIdsToDelete.push(status.id)
      continue
    }
    // A Note or Poll with no text at all (a captionless photo) still gets a
    // document: no word finds it, but operators alone (`from:me has:media`)
    // must.
    candidates.push({
      status,
      documentText: getStatusDocumentText(
        status,
        extraTextByStatusId.get(status.id)
      )
    })
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

// Refreshes the documents of the statuses that still exist, in one batch, after
// a change to something a status shows besides its own row (an attachment, a
// photo's species, its activity). `statusIds` may be a lookup, so finding them
// is inside the same best-effort boundary: the change has committed, and a
// stale document is what `yarn search:reindex` rebuilds. Call it after the
// write's transaction, never inside one: on PostgreSQL a caught failure would
// leave that transaction aborted.
export const indexStatusSearchDocumentsByIds = async (
  db: Db,
  statusIds: string[] | (() => Promise<string[]>)
): Promise<void> => {
  let ids: string[] = []
  try {
    ids = [
      ...new Set(
        typeof statusIds === 'function' ? await statusIds() : statusIds
      )
    ]
    const rows = await selectInChunks(db, ids, (chunk) =>
      selectSearchStatuses(db).where('id', 'in', chunk).execute()
    )
    await reindexStatusSearchDocuments(db, rows)
  } catch (error) {
    logger.error({
      message: 'Failed to refresh status search documents',
      statusIds: ids.slice(0, 20),
      err: toLoggableError(error)
    })
  }
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

// One search operator as a condition on the candidate status. `from:` reads
// handles case-insensitively, as account search does: a bare username is a
// local account on `localDomain`.
const statusSearchFilter = (
  eb: ExpressionBuilder<DB, 'search_documents' | 'statuses'>,
  filter: SearchFilter,
  { viewerId, localDomain }: { viewerId: string; localDomain: string | null }
): Expression<SqlBool> => {
  const attachmentOfType = (mediaTypes: string[]) =>
    eb.exists(
      eb
        .selectFrom('attachments')
        .select(sql.lit(1).as('one'))
        .whereRef('attachments.statusId', '=', 'statuses.id')
        .where((attachment) =>
          attachment.or(
            mediaTypes.map((mediaType) =>
              attachment(
                attachment.fn<string>('lower', ['attachments.mediaType']),
                'like',
                `${mediaType}/%`
              )
            )
          )
        )
    )
  const createdAt = sql.ref<number>('search_documents.entityCreatedAt')
  // The status blob is the JSON.stringify of a fixed shape, so a key and its
  // value appear as `"key":value` exactly once, and the same characters inside
  // a string value are escaped (`\"key\":`) and cannot match.
  // A status with no blob reads as an empty one, so a negated filter keeps it.
  const content = sql<string>`coalesce(${sql.ref('statuses.content')}, '')`

  switch (filter.type) {
    case 'from': {
      const { value } = filter
      if (value.kind === 'me') return eb('statuses.actorId', '=', viewerId)
      const domain = value.domain ?? localDomain
      if (!domain) return sql<SqlBool>`1 = 0`
      return eb(
        'statuses.actorId',
        'in',
        eb
          .selectFrom('actors')
          .select('actors.id')
          .where((actor) =>
            actor.and([
              actor(
                actor.fn<string>('lower', ['actors.username']),
                '=',
                value.username.toLowerCase()
              ),
              actor(actor.fn<string>('lower', ['actors.domain']), '=', domain)
            ])
          )
      )
    }
    case 'has':
      switch (filter.value) {
        case 'media':
          return attachmentOfType(['image', 'video', 'audio'])
        case 'image':
        case 'video':
        case 'audio':
          return attachmentOfType([filter.value])
        case 'poll':
          return eb('statuses.type', '=', StatusType.enum.Poll)
        case 'link':
        case 'embed':
          // A link is the one the post's preview card was made for; an embed is
          // a link whose card was fetched.
          return eb.exists(
            eb
              .selectFrom('status_link_previews')
              .select(sql.lit(1).as('one'))
              .whereRef('status_link_previews.statusId', '=', 'statuses.id')
              .$if(filter.value === 'embed', (qb) =>
                qb
                  .innerJoin(
                    'link_previews',
                    'link_previews.urlHash',
                    'status_link_previews.urlHash'
                  )
                  .where('link_previews.fetchStatus', '=', 'completed')
              )
          )
      }
      break
    case 'is':
      if (filter.value === 'reply') {
        return eb.and([
          eb('statuses.reply', 'is not', null),
          eb('statuses.reply', '<>', '')
        ])
      }
      // Sensitive, or carrying a content warning.
      return eb.or([
        eb(content, 'like', '%"sensitive":true%'),
        eb.and([
          eb(content, 'like', '%"summary":"%'),
          eb(content, 'not like', '%"summary":""%')
        ])
      ])
    case 'language':
      // The language the post declares, else the one detected from its text.
      return eb.or([
        eb(
          eb.fn<string>('lower', [content]),
          'like',
          `%"language":"${filter.value}"%`
        ),
        eb.and([
          eb.or([
            eb(content, 'not like', '%"language":"%'),
            eb(content, 'like', '%"language":""%')
          ]),
          eb.exists(
            eb
              .selectFrom('status_detected_languages')
              .select(sql.lit(1).as('one'))
              .whereRef(
                'status_detected_languages.statusId',
                '=',
                'statuses.id'
              )
              .where((detected) =>
                detected(
                  detected.fn<string>('lower', [
                    'status_detected_languages.language'
                  ]),
                  '=',
                  filter.value
                )
              )
          )
        ])
      ])
    case 'before':
      return eb(createdAt, '<', timestampValue(filter.value))
    case 'after':
      return eb(createdAt, '>=', timestampValue(getSearchDayEnd(filter.value)))
    case 'during':
      return eb.and([
        eb(createdAt, '>=', timestampValue(filter.value)),
        eb(createdAt, '<', timestampValue(getSearchDayEnd(filter.value)))
      ])
  }
  return sql<SqlBool>`1 = 0`
}

export const searchStatusIds = async (
  db: Db,
  {
    q,
    parsedQuery,
    limit,
    offset = 0,
    currentActorId,
    currentActorUsername,
    currentActorDomain,
    localDomain,
    accountId,
    minId,
    maxId
  }: SearchStatusesParams
): Promise<string[]> => {
  const parsed = parsedQuery ?? parseSearchQuery(q)
  const hasText = parsed.terms.length > 0 || parsed.phrases.length > 0
  // A search needs a word, a phrase or an operator: exclusions alone, or
  // nothing searchable at all, match nothing.
  if (!hasText && parsed.filters.length === 0) return []

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
  if (hasText || parsed.excluded.length > 0) {
    query = fullTextQueryMatch(db, query, parsed)
  }
  // A bare `from:username` names an account on this domain; a caller that gave
  // no domain gets the viewer's own.
  let fromDomain = (localDomain ?? currentActorDomain)?.toLowerCase() ?? null
  if (
    !fromDomain &&
    parsed.filters.some(
      (filter) =>
        filter.type === 'from' &&
        filter.value.kind === 'handle' &&
        filter.value.domain === null
    )
  ) {
    const viewer = await db
      .selectFrom('actors')
      .select('domain')
      .where('id', '=', viewerId)
      .executeTakeFirst()
    fromDomain = viewer?.domain?.toLowerCase() ?? null
  }
  const filterContext = { viewerId, localDomain: fromDomain }
  for (const filter of parsed.filters) {
    query = query.where((eb) => {
      const condition = statusSearchFilter(eb, filter, filterContext)
      return filter.negated ? eb.not(condition) : condition
    })
  }
  if (accountId) query = query.where('statuses.actorId', '=', accountId)
  query = query
    .where((eb) => potentiallyReadableStatus(db, eb, viewerId))
    // Search finds only statuses the viewer wrote, liked, bookmarked or was
    // mentioned in: their library. `in:all` searches the same library until
    // opt-in public search adds the posts their authors made searchable.
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
