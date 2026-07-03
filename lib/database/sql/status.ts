import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { incrementLocalStatusBucket } from '@/lib/database/sql/instanceActivity'
import { coercePollEndAt } from '@/lib/database/sql/utils/coercePollEndAt'
import {
  CounterKey,
  decreaseCounterValue,
  deleteCounterValues,
  getCounterValue,
  getCounterValues,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import { decodeFavouritedByCursor } from '@/lib/database/sql/utils/favouritedByCursor'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import {
  chunkArray,
  deleteRowsByColumnChunks,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import { parseStatusContent } from '@/lib/database/sql/utils/parseStatusContent'
import {
  StatusHashtagTagRow,
  selectHashtagTagsByStatusIds
} from '@/lib/database/sql/utils/status'
import {
  PUBLIC_ACTIVITY_RECIPIENTS,
  applyPotentiallyReadableStatusFilter as applyPotentiallyReadableStatusVisibilityFilter
} from '@/lib/database/sql/utils/statusVisibility'
import { isFitnessProcessingStuck } from '@/lib/services/fitness-files/processingState'
import { SQLFitnessFile } from '@/lib/types/database/fitnessFile'
import { ActorDatabase } from '@/lib/types/database/operations'
import { BookmarkDatabase } from '@/lib/types/database/operations'
import { LikeDatabase } from '@/lib/types/database/operations'
import { MediaDatabase } from '@/lib/types/database/operations'
import {
  AddStatusTagParams,
  CreateAnnounceParams,
  CreateNoteParams,
  CreatePollAnswerParams,
  CreatePollParams,
  CreateTagParams,
  DeleteStatusParams,
  DeleteStatusTagsByTypeParams,
  FavouritedByAccount,
  GetActorPollVotesForStatusesParams,
  GetActorPollVotesParams,
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  GetFavouritedByParams,
  GetHashtagStatusesPageParams,
  GetPinnedStatusIdsParams,
  GetRebloggedByParams,
  GetStatusCountsParams,
  GetStatusEditHistoryParams,
  GetStatusFromUrlHashParams,
  GetStatusFromUrlParams,
  GetStatusParams,
  GetStatusReblogsCountParams,
  GetStatusRepliesCountParams,
  GetStatusRepliesParams,
  GetStatusesByHashtagParams,
  GetStatusesByIdsParams,
  GetTagsParams,
  HasActorAnnouncedStatusParams,
  HasActorVotedParams,
  IncrementPollChoiceVotesParams,
  PinStatusParams,
  RecordPollVotesParams,
  StatusDatabase,
  StatusDetectedLanguageDatabase,
  StatusEditRevision,
  UpdateNoteParams,
  UpdateNoteVisibilityParams,
  UpdatePollParams
} from '@/lib/types/database/operations'
import { getActorProfile } from '@/lib/types/domain/actor'
import { Attachment, isFitnessAttachment } from '@/lib/types/domain/attachment'
import { PollChoice } from '@/lib/types/domain/pollChoice'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import {
  deleteStatusSearchDocumentsByStatusIds,
  indexHashtagSearchDocument,
  indexHashtagSearchDocuments,
  indexStatusSearchDocument,
  normalizeHashtagSearchName
} from './search'
import type { SQLStatusSearchRow } from './search'
import { getCompatibleJSON } from './utils/getCompatibleJSON'

const MAX_ANNOUNCE_RESOLUTION_DEPTH = 10
// Counts breadth-first reply levels from the deleted root, not total replies.
// This bounds transaction size while still allowing wide conversation cleanup.
const MAX_STATUS_REPLY_DELETE_DEPTH = 100

type StatusDeletionRow = {
  id: string
  actorId: string
  type: StatusType
  reply: string | null
  content: unknown
  originalStatusId: string | null
}

const statusReplyDeletionDepthError = (statusId: string) =>
  new Error(`Status reply deletion depth limit exceeded for status ${statusId}`)

const isReplaceableMediaAttachment = (
  attachment: Attachment
): attachment is Attachment & { mediaId: string } =>
  !isFitnessAttachment(attachment) &&
  attachment.mediaId !== null &&
  attachment.mediaId !== undefined

const publicRecipientStatusIds = (database: Knex) =>
  database('recipients')
    .select('statusId')
    .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)

type StatusHydrationContext = {
  bookmarkedStatusIds?: Set<string>
  likedStatusIds?: Set<string>
  // Pre-batched content-detected languages, keyed by statusId. Viewer-
  // independent (unlike the like/bookmark sets above), so callers populate it
  // for any timeline page regardless of whether a viewer is signed in.
  detectedLanguages?: Record<string, string>
}

export const buildPubliclyReadableStatusIdsQuery = ({
  database,
  targetStatusIds
}: {
  database: Knex
  targetStatusIds: Knex.QueryBuilder
}) => {
  const clientName = String(database.client.config.client)
  const targetStatusIdsQuery = targetStatusIds.clone().as('target_status_ids')

  if (clientName.includes('mysql')) {
    return database
      .select('target_statuses.id')
      .from(targetStatusIdsQuery)
      .innerJoin(
        'statuses as target_statuses',
        'target_statuses.id',
        'target_status_ids.id'
      )
      .whereIn('target_statuses.id', publicRecipientStatusIds(database))
      .where((qb) => {
        qb.whereNot(
          'target_statuses.type',
          StatusType.enum.Announce
        ).orWhereExists(function () {
          this.select(database.raw('1'))
            .from('statuses as original_statuses')
            .where((originalBuilder) => {
              originalBuilder
                .whereRaw('?? = ??', [
                  'original_statuses.id',
                  'target_statuses.originalStatusId'
                ])
                .orWhere((legacyBuilder) => {
                  legacyBuilder
                    .whereNull('target_statuses.originalStatusId')
                    .whereRaw('?? = ??', [
                      'original_statuses.id',
                      'target_statuses.content'
                    ])
                })
            })
            .whereNot('original_statuses.type', StatusType.enum.Announce)
            .whereIn('original_statuses.id', publicRecipientStatusIds(database))
        })
      })
  }

  return database
    .withRecursive(
      'publicly_readable_statuses',
      ['targetId', 'id', 'type', 'originalStatusId', 'content'],
      (cte) => {
        cte
          .select(
            'target_statuses.id as targetId',
            'target_statuses.id',
            'target_statuses.type',
            'target_statuses.originalStatusId',
            'target_statuses.content'
          )
          .from(targetStatusIdsQuery)
          .innerJoin(
            'statuses as target_statuses',
            'target_statuses.id',
            'target_status_ids.id'
          )
          .whereIn('target_statuses.id', publicRecipientStatusIds(database))
          .union((qb) => {
            qb.select(
              'readable_statuses.targetId',
              'original_statuses.id',
              'original_statuses.type',
              'original_statuses.originalStatusId',
              'original_statuses.content'
            )
              .from('statuses as original_statuses')
              .innerJoin(
                'publicly_readable_statuses as readable_statuses',
                database.raw('(?? = ?? or (?? is null and ?? = ??))', [
                  'readable_statuses.originalStatusId',
                  'original_statuses.id',
                  'readable_statuses.originalStatusId',
                  'readable_statuses.content',
                  'original_statuses.id'
                ])
              )
              .where('readable_statuses.type', StatusType.enum.Announce)
              .whereIn(
                'original_statuses.id',
                publicRecipientStatusIds(database)
              )
          })
      }
    )
    .select('targetId as id')
    .from('publicly_readable_statuses')
    .whereNot('type', StatusType.enum.Announce)
}

export const StatusSQLDatabaseMixin = (
  database: Knex,
  actorDatabase: ActorDatabase,
  likeDatabase: LikeDatabase,
  bookmarkDatabase: BookmarkDatabase,
  mediaDatabase: MediaDatabase,
  statusDetectedLanguageDatabase: StatusDetectedLanguageDatabase
): StatusDatabase => {
  const applyPublicReadableStatusFilter = ({
    query,
    targetStatusIds
  }: {
    query: Knex.QueryBuilder
    targetStatusIds: Knex.QueryBuilder
  }) =>
    query.whereIn(
      'statuses.id',
      buildPubliclyReadableStatusIdsQuery({ database, targetStatusIds })
    )

  const applyPotentiallyReadableStatusFilter = ({
    query,
    visibleToActorId
  }: {
    query: Knex.QueryBuilder
    visibleToActorId: string
  }) =>
    applyPotentiallyReadableStatusVisibilityFilter({
      database,
      query,
      visibleToActorId
    })

  const sortAttachmentsForFitnessMap = <T extends { id: string; url: string }>(
    attachments: T[],
    mapImagePath?: string | null
  ): T[] => {
    if (!mapImagePath) return attachments

    const normalizedMapImagePath = decodeURIComponent(mapImagePath).replace(
      /^\/+/,
      ''
    )
    const mapAttachment = attachments.find((attachment) => {
      const attachmentPath = getAttachmentMediaPath(attachment.url)
      return (
        attachmentPath === normalizedMapImagePath ||
        attachmentPath.endsWith(normalizedMapImagePath)
      )
    })

    if (!mapAttachment) return attachments

    return [...attachments].sort((a, b) => {
      if (a.id === mapAttachment.id) return -1
      if (b.id === mapAttachment.id) return 1
      return 0
    })
  }

  const getOriginalStatusIdFromAnnounceContent = (
    content: unknown
  ): string | null => {
    const parsed = parseStatusContent(content)
    if (!parsed) return null
    if (typeof parsed === 'string') {
      return parsed
    }
    if (typeof parsed.url === 'string' && parsed.url.length > 0) {
      return parsed.url
    }
    if (typeof parsed.id === 'string' && parsed.id.length > 0) {
      return parsed.id
    }
    return null
  }

  const getAnnounceOriginalStatusId = ({
    content,
    originalStatusId
  }: {
    content?: unknown
    originalStatusId?: string | null
  }): string | null =>
    originalStatusId || getOriginalStatusIdFromAnnounceContent(content)

  const getStatusUrlHash = (url: string): string => getHashFromString(url)
  const getStatusReplyHash = (reply: string): string | null =>
    reply ? getHashFromString(reply) : null

  const resolveParentStatusIdByReply = async (
    reply: string,
    trx: Knex.Transaction
  ): Promise<string | null> => {
    if (!reply) return null

    const byId = await trx('statuses')
      .where('id', reply)
      .first<{ id: string }>('id')
    if (byId?.id) return byId.id

    const byUrl = await trx('statuses')
      .where('urlHash', getStatusUrlHash(reply))
      .andWhere('url', reply)
      .first<{ id: string }>('id')
    if (byUrl?.id) return byUrl.id

    return null
  }

  const updateStatusCounters = async ({
    actorId,
    type,
    reply,
    content,
    step,
    trx,
    currentTime
  }: {
    actorId: string
    type: StatusType
    reply: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: any
    step: 'increment' | 'decrement'
    trx: Knex.Transaction
    currentTime: Date
  }) => {
    const adjust =
      step === 'increment' ? increaseCounterValue : decreaseCounterValue

    await adjust(trx, CounterKey.totalStatus(actorId), 1, currentTime)
    await adjust(trx, CounterKey.serviceTotalStatuses(), 1, currentTime)
    if (step === 'increment') {
      await incrementBucket(trx, 'statuses', 1, currentTime)
    }

    const actor = await trx('actors')
      .where('id', actorId)
      .first<{ accountId: string | null }>('accountId')
    if (actor?.accountId) {
      await adjust(trx, CounterKey.nodeinfoLocalPosts(), 1, currentTime)
      if (step === 'increment') {
        await incrementLocalStatusBucket(trx, currentTime)
      }
    }

    if (type === StatusType.enum.Announce) {
      const originalStatusId = getOriginalStatusIdFromAnnounceContent(content)
      if (originalStatusId) {
        await adjust(
          trx,
          CounterKey.totalReblog(originalStatusId),
          1,
          currentTime
        )
      }
    }

    if (reply) {
      const parentStatusId = await resolveParentStatusIdByReply(reply, trx)
      if (parentStatusId) {
        await adjust(trx, CounterKey.totalReply(parentStatusId), 1, currentTime)
      }
    }
  }

  // Public
  async function createNote({
    id,
    url,
    actorId,
    text,
    summary = '',
    to,
    cc,
    reply = '',
    sensitive = false,
    language = null,
    applicationName = null,
    applicationWebsite = null,
    createdAt
  }: CreateNoteParams) {
    const currentTime = new Date()
    const statusCreatedAt = createdAt ? new Date(createdAt) : currentTime
    const statusUpdatedAt = currentTime
    const content = {
      url,
      text,
      summary,
      sensitive,
      language
    }
    const statusContent = JSON.stringify(content)
    const searchStatus: SQLStatusSearchRow = {
      id,
      actorId,
      type: StatusType.enum.Note,
      content: statusContent,
      createdAt: statusCreatedAt
    }

    await database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        url,
        urlHash: getStatusUrlHash(url),
        actorId,
        type: StatusType.enum.Note,
        content: statusContent,
        applicationName,
        applicationWebsite,
        reply,
        replyHash: getStatusReplyHash(reply),
        createdAt: statusCreatedAt,
        updatedAt: statusUpdatedAt
      })
      await updateStatusCounters({
        actorId,
        type: StatusType.enum.Note,
        reply,
        content,
        step: 'increment',
        trx,
        currentTime
      })
      await Promise.all(
        to.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId,
            type: 'to',

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )

      await Promise.all(
        cc.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId,
            type: 'cc',

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )
    })

    await indexStatusSearchDocument(database, { status: searchStatus })

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    return StatusNote.parse({
      id,
      url,
      actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: StatusType.enum.Note,
      text,
      summary,
      sensitive,
      language,
      // Content detection runs after this insert (in the actions/jobs layer
      // that called createNote), so the row this function just wrote has no
      // detected language yet — matches what a hydrated re-fetch would show
      // at this same instant.
      detectedLanguage: null,
      applicationName,
      applicationWebsite,
      reply,
      to,
      cc,
      edits: [],
      attachments: [],
      tags: [],
      replies: [],
      totalLikes: 0,
      isActorLiked: false,
      isActorBookmarked: false,
      actorAnnounceStatusId: null,
      isLocalActor: Boolean(actor?.account),
      createdAt: getCompatibleTime(statusCreatedAt),
      updatedAt: getCompatibleTime(statusUpdatedAt)
    })
  }

  async function updateNote({
    statusId,
    text,
    summary,
    attachments,
    sensitive,
    language
  }: UpdateNoteParams): Promise<Status | null> {
    const status = await getStatus({ statusId })
    if (!status) return null

    if (status.type !== StatusType.enum.Note) return null

    const previousData = {
      text: status.text,
      summary: status.summary
    }
    const currentTime = new Date()
    const content = {
      url: status.url,
      text,
      summary,
      // Preserve the existing flags unless the caller explicitly overrides them.
      sensitive: sensitive === undefined ? status.sensitive : sensitive,
      language: language === undefined ? status.language : language
    }
    const statusContent = JSON.stringify(content)
    const searchStatus: SQLStatusSearchRow = {
      id: status.id,
      actorId: status.actorId,
      type: status.type,
      content: statusContent,
      createdAt: status.createdAt
    }
    await database.transaction(async (trx) => {
      await trx('status_history').insert({
        statusId: status.id,
        data: JSON.stringify(previousData),
        createdAt: new Date(status.createdAt),
        updatedAt: currentTime
      })
      await trx('statuses')
        .where('id', status.id)
        .update({
          url: status.url || null,
          urlHash: status.url ? getStatusUrlHash(status.url) : null,
          content: statusContent,
          updatedAt: currentTime
        })

      if (attachments !== undefined) {
        const incomingMediaIds = new Set(
          attachments.map((attachment) => attachment.id)
        )
        const existingReplaceableAttachments = status.attachments.filter(
          isReplaceableMediaAttachment
        )
        const replaceableAttachmentIds = status.attachments
          .filter(
            (attachment) =>
              isReplaceableMediaAttachment(attachment) &&
              !incomingMediaIds.has(attachment.mediaId)
          )
          .map((attachment) => attachment.id)
        if (replaceableAttachmentIds.length > 0) {
          await trx('attachments')
            .where('statusId', status.id)
            .where('actorId', status.actorId)
            .whereIn('id', replaceableAttachmentIds)
            .delete()
        }

        const existingMediaIds = new Set(
          existingReplaceableAttachments.map((attachment) => attachment.mediaId)
        )
        const newAttachments = attachments.filter(
          (attachment) => !existingMediaIds.has(attachment.id)
        )

        await Promise.all(
          newAttachments.map((attachment, index) => {
            const attachmentCreatedAt = new Date(currentTime.getTime() + index)
            const data = Attachment.parse({
              id: crypto.randomUUID(),
              actorId: status.actorId,
              statusId: status.id,
              type: 'Document',
              mediaType: attachment.mediaType,
              url: attachment.url,
              width: attachment.width,
              height: attachment.height,
              name: attachment.name ?? '',
              mediaId: attachment.id,
              createdAt: attachmentCreatedAt.getTime(),
              updatedAt: attachmentCreatedAt.getTime()
            })

            return trx('attachments').insert({
              ...data,
              createdAt: attachmentCreatedAt,
              updatedAt: attachmentCreatedAt
            })
          })
        )
      }
    })
    await indexStatusSearchDocument(database, { status: searchStatus })
    return getStatus({ statusId })
  }

  async function updateNoteVisibility({
    statusId,
    to,
    cc
  }: UpdateNoteVisibilityParams): Promise<Status | null> {
    const status = await getStatus({ statusId })
    if (!status) return null
    if (status.type !== StatusType.enum.Note) return null

    let affectedHashtags: string[] = []
    const currentTime = new Date()
    const searchStatus: SQLStatusSearchRow = {
      id: status.id,
      actorId: status.actorId,
      type: status.type,
      content: JSON.stringify({
        url: status.url,
        text: status.text,
        summary: status.summary
      }),
      createdAt: status.createdAt
    }
    await database.transaction(async (trx) => {
      await trx('recipients').where('statusId', status.id).delete()
      await trx('timelines').where('statusId', status.id).delete()
      await Promise.all(
        to.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: status.id,
            actorId,
            type: 'to',
            createdAt: currentTime,
            updatedAt: currentTime
          })
        )
      )
      await Promise.all(
        cc.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: status.id,
            actorId,
            type: 'cc',
            createdAt: currentTime,
            updatedAt: currentTime
          })
        )
      )
      const hashtagTags = await selectHashtagTagsByStatusIds(trx, [status.id])
      affectedHashtags = hashtagTags.map((tag) => tag.name)
    })
    if (affectedHashtags.length > 0) {
      await indexHashtagSearchDocuments(database, {
        hashtags: affectedHashtags
      })
    }
    await indexStatusSearchDocument(database, { status: searchStatus })
    return getStatus({ statusId })
  }

  async function createAnnounce({
    id,
    actorId,
    to,
    cc,
    originalStatusId,
    createdAt
  }: CreateAnnounceParams) {
    const currentTime = new Date()
    const statusCreatedAt = createdAt ? new Date(createdAt) : currentTime
    const statusUpdatedAt = currentTime

    await database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        url: null,
        urlHash: null,
        actorId,
        type: StatusType.enum.Announce,
        reply: '',
        replyHash: null,
        content: originalStatusId,
        originalStatusId,
        createdAt: statusCreatedAt,
        updatedAt: statusUpdatedAt
      })
      await updateStatusCounters({
        actorId,
        type: StatusType.enum.Announce,
        reply: '',
        content: originalStatusId,
        step: 'increment',
        trx,
        currentTime
      })
      await Promise.all(
        to.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId,
            type: 'to',

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )

      await Promise.all(
        cc.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId,
            type: 'cc',

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )
    })

    const [originalStatus, actor] = await Promise.all([
      getStatus({ statusId: originalStatusId }),
      actorDatabase.getActorFromId({ id: actorId })
    ])
    return StatusAnnounce.parse({
      id,
      actorId,
      actor: actor ? getActorProfile(actor) : null,
      to,
      cc,
      edits: [],
      type: StatusType.enum.Announce,
      originalStatus: originalStatus as StatusNote,

      isLocalActor: Boolean(actor?.account),
      createdAt: getCompatibleTime(statusUpdatedAt),
      updatedAt: getCompatibleTime(statusUpdatedAt)
    })
  }

  async function createPoll({
    id,
    url,
    actorId,
    text,
    summary = '',
    to,
    cc,
    reply = '',
    endAt,
    choices,
    pollType = 'oneOf',
    sensitive = false,
    language = null,
    applicationName = null,
    applicationWebsite = null,
    createdAt
  }: CreatePollParams) {
    const currentTime = new Date()
    const statusCreatedAt = createdAt ? new Date(createdAt) : currentTime
    const statusUpdatedAt = currentTime
    const content = {
      url,
      text,
      summary,
      sensitive,
      language,
      endAt,
      pollType
    }
    const statusContent = JSON.stringify(content)
    const searchStatus: SQLStatusSearchRow = {
      id,
      actorId,
      type: StatusType.enum.Poll,
      content: statusContent,
      createdAt: statusCreatedAt
    }

    await database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        url,
        urlHash: getStatusUrlHash(url),
        actorId,
        type: StatusType.enum.Poll,
        content: statusContent,
        applicationName,
        applicationWebsite,
        reply,
        replyHash: getStatusReplyHash(reply),
        createdAt: statusCreatedAt,
        updatedAt: statusUpdatedAt
      })
      await updateStatusCounters({
        actorId,
        type: StatusType.enum.Poll,
        reply,
        content,
        step: 'increment',
        trx,
        currentTime
      })
      await Promise.all(
        choices.map((choice) =>
          trx('poll_choices').insert({
            statusId: id,
            title: choice,

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )
      await Promise.all(
        to.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId,
            type: 'to',

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )

      await Promise.all(
        cc.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId,
            type: 'cc',

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )
    })

    await indexStatusSearchDocument(database, { status: searchStatus })

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    return StatusPoll.parse({
      id,
      url,
      actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: StatusType.enum.Poll,
      text,
      summary,
      sensitive,
      language,
      // Content detection runs after this insert (in the actions/jobs layer
      // that called createPoll), so the row this function just wrote has no
      // detected language yet — matches what a hydrated re-fetch would show
      // at this same instant.
      detectedLanguage: null,
      applicationName,
      applicationWebsite,
      reply,
      to,
      cc,
      edits: [],
      attachments: [],
      tags: [],
      replies: [],
      choices: [],
      totalLikes: 0,
      isActorLiked: false,
      isActorBookmarked: false,
      actorAnnounceStatusId: null,
      endAt,
      pollType,
      isLocalActor: Boolean(actor?.account),
      createdAt: getCompatibleTime(statusCreatedAt),
      updatedAt: getCompatibleTime(statusUpdatedAt)
    })
  }

  async function updatePoll({
    statusId,
    text,
    summary,
    choices
  }: UpdatePollParams) {
    const existingStatus = await database('statuses')
      .where('id', statusId)
      .first()
    if (!existingStatus) return null
    const currentTime = new Date()
    const data = getCompatibleJSON(existingStatus.content)
    const nextText = text ?? data.text
    const nextSummary = summary ?? data.summary
    const content = {
      url: data.url,
      text: nextText,
      summary: nextSummary,
      sensitive: data.sensitive ?? false,
      language: data.language ?? null,
      endAt: data.endAt,
      pollType: data.pollType
    }
    const statusContent = JSON.stringify(content)
    const searchStatus: SQLStatusSearchRow = {
      id: existingStatus.id,
      actorId: existingStatus.actorId,
      type: existingStatus.type,
      content: statusContent,
      createdAt: existingStatus.createdAt
    }

    await database.transaction(async (trx) => {
      if (nextText !== data.text || nextSummary !== data.summary) {
        const previousData = {
          text: data.text,
          summary: data.summary
        }
        await trx('status_history').insert({
          statusId,
          data: JSON.stringify(previousData),
          createdAt: new Date(existingStatus.createdAt),
          updatedAt: currentTime
        })
        await trx('statuses')
          .where('id', statusId)
          .update({
            url: data.url || null,
            urlHash: data.url ? getStatusUrlHash(data.url) : null,
            content: statusContent,
            updatedAt: currentTime
          })
      }
      for (const choice of choices) {
        await trx('poll_choices')
          .where({
            statusId,
            title: choice.title
          })
          .update({
            totalVotes: choice.totalVotes,
            updatedAt: currentTime
          })
      }
    })
    await indexStatusSearchDocument(database, { status: searchStatus })
    return getStatus({ statusId })
  }

  async function getStatus({
    statusId,
    withReplies,
    currentActorId
  }: GetStatusParams) {
    return getStatusWithHydration({
      statusId,
      currentActorId,
      withReplies
    })
  }

  async function getStatusWithHydration({
    statusId,
    withReplies,
    currentActorId,
    hydrationContext = {}
  }: GetStatusParams & { hydrationContext?: StatusHydrationContext }) {
    const status = await database('statuses').where('id', statusId).first()
    if (!status) return null

    return getStatusWithAttachmentsFromData(
      status,
      currentActorId,
      withReplies,
      hydrationContext
    )
  }

  const getReplyTargetStatusIds = ({
    statusId,
    url
  }: {
    statusId: string
    url?: string
  }) =>
    database('statuses')
      .select('statuses.id')
      .where((builder) => {
        builder.where('reply', statusId)
        if (url) {
          builder.orWhere('reply', url)
        }
      })

  const getActorTargetStatusIds = (actorId: string) =>
    database('statuses').select('statuses.id').where('actorId', actorId)

  async function getStatusEditHistory({
    statusId
  }: GetStatusEditHistoryParams): Promise<StatusEditRevision[]> {
    // Each row holds the content of a prior version; `updatedAt` is when that
    // version was superseded. Ordered oldest-first (insertion order) so the
    // serializer can reconstruct the revision timeline.
    const rows = await database('status_history')
      .where('statusId', statusId)
      .orderBy('updatedAt', 'asc')
      .orderBy('id', 'asc')
    return rows.map((row) => {
      const content = getCompatibleJSON(row.data)
      return {
        text: content?.text ?? '',
        summary: content?.summary ?? null,
        supersededAt: getCompatibleTime(row.updatedAt)
      }
    })
  }

  async function getStatusReplies({
    statusId,
    url,
    limit,
    publicOnly = false,
    visibleToActorId
  }: GetStatusRepliesParams) {
    let query = database('statuses')
      .where((builder) => {
        builder.where('reply', statusId)
        if (url) {
          builder.orWhere('reply', url)
        }
      })
      .orderBy('createdAt', 'desc')

    if (publicOnly) {
      query = applyPublicReadableStatusFilter({
        query,
        targetStatusIds: getReplyTargetStatusIds({ statusId, url })
      })
    } else if (visibleToActorId) {
      query = applyPotentiallyReadableStatusFilter({
        query,
        visibleToActorId
      })
    }

    if (limit) {
      query = query.limit(limit)
    }

    const statuses = await query
    // Batch detected-language hydration so this doesn't N+1 one query per
    // reply (mirroring getStatusesByIds).
    const hydrationStatusIds = await collectHydrationStatusIds(statuses)
    const hydrationContext: StatusHydrationContext = {
      detectedLanguages:
        hydrationStatusIds.size > 0
          ? await statusDetectedLanguageDatabase.getDetectedLanguages({
              statusIds: [...hydrationStatusIds]
            })
          : {}
    }
    const statusesWithAttachments = (
      await Promise.all(
        statuses.map((item) =>
          getStatusWithAttachmentsFromData(
            item,
            undefined,
            undefined,
            hydrationContext
          )
        )
      )
    ).filter((status): status is Status => status !== null)
    return statusesWithAttachments
  }

  async function hasActorAnnouncedStatus({
    actorId,
    statusId
  }: HasActorAnnouncedStatusParams): Promise<boolean> {
    if (!actorId) return false

    const result = await database('statuses')
      .where('type', StatusType.enum.Announce)
      .where('originalStatusId', statusId)
      .where('actorId', actorId)
      .count<{ count: string }>('* as count')
      .first()
    if (!result) return false
    return parseInt(result.count, 10) !== 0
  }

  async function getActorAnnounceStatus({
    actorId,
    statusId
  }: HasActorAnnouncedStatusParams): Promise<Status | null> {
    if (!actorId) return null

    const data = await database('statuses')
      .where('type', StatusType.enum.Announce)
      .where('originalStatusId', statusId)
      .where('actorId', actorId)
      .first()

    if (!data) return null
    return getStatusWithAttachmentsFromData(data)
  }

  async function getActorStatusesCount({
    actorId,
    publicOnly = false
  }: GetActorStatusesCountParams) {
    if (publicOnly) {
      const result = await applyPublicReadableStatusFilter({
        query: database('statuses').where('actorId', actorId),
        targetStatusIds: getActorTargetStatusIds(actorId)
      })
        .countDistinct<{ count: string | number }>({
          count: 'statuses.id'
        })
        .first()

      return parseInt(String(result?.count ?? '0'), 10)
    }

    return getCounterValue(database, CounterKey.totalStatus(actorId))
  }

  async function getActorStatuses({
    actorId,
    minStatusId,
    maxStatusId,
    limit = PER_PAGE_LIMIT,
    publicOnly = false,
    visibleToActorId,
    includeFollowersOnly = false,
    followersAudience,
    onlyMedia = false,
    excludeReplies = false,
    excludeReblogs = false,
    tagged,
    pinned = false
  }: GetActorStatusesParams) {
    let query = database('statuses')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)

    const recipientActorIds =
      publicOnly || visibleToActorId || includeFollowersOnly
        ? [...PUBLIC_ACTIVITY_RECIPIENTS]
        : null

    if (recipientActorIds) {
      if (!publicOnly) {
        if (includeFollowersOnly) {
          recipientActorIds.push(
            ...[followersAudience, `${actorId}/followers`].filter(
              (audience): audience is string => Boolean(audience)
            )
          )
        }
        if (visibleToActorId) {
          recipientActorIds.push(visibleToActorId)
        }
      }

      if (publicOnly) {
        query = applyPublicReadableStatusFilter({
          query,
          targetStatusIds: getActorTargetStatusIds(actorId)
        })
      } else {
        query = query.whereIn(
          'statuses.id',
          database('recipients')
            .select('statusId')
            .whereIn('recipients.actorId', [...new Set(recipientActorIds)])
        )
      }
    }

    if (onlyMedia) {
      query = query.whereExists(function () {
        this.select(database.raw('1'))
          .from('attachments')
          .whereRaw('?? = ??', ['attachments.statusId', 'statuses.id'])
      })
    }

    if (excludeReplies) {
      query = query.where((builder) => {
        builder
          .where((noReply) => {
            noReply.whereNull('statuses.reply').orWhere('statuses.reply', '')
          })
          .orWhereExists(function () {
            this.select(database.raw('1'))
              .from('statuses as reply_parent_by_id')
              .where('reply_parent_by_id.actorId', actorId)
              .whereRaw('?? = ??', ['reply_parent_by_id.id', 'statuses.reply'])
          })
          .orWhereExists(function () {
            this.select(database.raw('1'))
              .from('statuses as reply_parent_by_url')
              .where('reply_parent_by_url.actorId', actorId)
              .whereRaw('?? = ??', [
                'reply_parent_by_url.urlHash',
                'statuses.replyHash'
              ])
              .whereRaw('?? = ??', [
                'reply_parent_by_url.url',
                'statuses.reply'
              ])
          })
      })
    }

    if (excludeReblogs) {
      query = query.whereNot('statuses.type', StatusType.enum.Announce)
    }

    if (tagged !== undefined && tagged !== null) {
      const normalizedNames = getHashtagLookupNames(tagged)
      if (normalizedNames.length === 0) {
        query = query.whereRaw('1 = 0')
      } else {
        query = query.whereExists(function () {
          this.select(database.raw('1'))
            .from('tags')
            .whereRaw('?? = ??', ['tags.statusId', 'statuses.id'])
            .where('tags.type', 'hashtag')
            .whereIn('tags.nameNormalized', normalizedNames)
        })
      }
    }

    if (pinned) {
      query = query.whereExists(function () {
        this.select(database.raw('1'))
          .from('status_pins')
          .where('status_pins.actorId', actorId)
          .whereRaw('?? = ??', ['status_pins.statusId', 'statuses.id'])
      })
    }

    if (minStatusId) {
      const minStatus = await database('statuses')
        .where('id', minStatusId)
        .first()
      if (minStatus) {
        query = query.where((wb) => {
          wb.where('statuses.createdAt', '>', minStatus.createdAt).orWhere(
            (sameCreatedAt) => {
              sameCreatedAt
                .where('statuses.createdAt', '=', minStatus.createdAt)
                .where('statuses.id', '>', minStatusId)
            }
          )
        })
      }
    }

    if (maxStatusId) {
      const maxStatus = await database('statuses')
        .where('id', maxStatusId)
        .first()
      if (maxStatus) {
        query = query.where((wb) => {
          wb.where('statuses.createdAt', '<', maxStatus.createdAt).orWhere(
            (sameCreatedAt) => {
              sameCreatedAt
                .where('statuses.createdAt', '=', maxStatus.createdAt)
                .where('statuses.id', '<', maxStatusId)
            }
          )
        })
      }
    }

    const statuses = await query
    // Batch detected-language hydration so this doesn't N+1 one query per
    // status (mirroring getStatusesByIds) — actor status lists back profile
    // pages and the Mastodon accounts/:id/statuses endpoint.
    const hydrationStatusIds = await collectHydrationStatusIds(statuses)
    const hydrationContext: StatusHydrationContext = {
      detectedLanguages:
        hydrationStatusIds.size > 0
          ? await statusDetectedLanguageDatabase.getDetectedLanguages({
              statusIds: [...hydrationStatusIds]
            })
          : {}
    }
    const statusesWithAttachments = (
      await Promise.all(
        statuses.map((item) =>
          getStatusWithAttachmentsFromData(
            item,
            undefined,
            undefined,
            hydrationContext
          )
        )
      )
    ).filter((status): status is Status => status !== null)
    return statusesWithAttachments
  }

  async function pinStatus({
    actorId,
    statusId,
    maxPinnedStatuses
  }: PinStatusParams) {
    const currentTime = new Date()
    return database.transaction(async (trx) => {
      if (maxPinnedStatuses !== undefined) {
        await trx('actors').where({ id: actorId }).select('id').forUpdate()

        const existingPin = await trx('status_pins')
          .where({ actorId, statusId })
          .first<{ statusId: string }>('statusId')
        if (existingPin) return true

        const [{ count }] = await trx('status_pins')
          .where({ actorId })
          .count<{ count: string | number }[]>({ count: '*' })
        if (Number(count) >= maxPinnedStatuses) return false
      }

      await trx('status_pins')
        .insert({
          actorId,
          statusId,
          createdAt: currentTime,
          updatedAt: currentTime
        })
        .onConflict(['actorId', 'statusId'])
        .ignore()
      return true
    })
  }

  async function unpinStatus({ actorId, statusId }: PinStatusParams) {
    await database('status_pins').where({ actorId, statusId }).delete()
  }

  async function getPinnedStatusIds({
    actorId,
    statusIds
  }: GetPinnedStatusIdsParams) {
    if (statusIds && statusIds.length === 0) return []

    if (statusIds) {
      const uniqueStatusIds = [...new Set(statusIds)]
      const rows: { statusId: string; createdAt: Date | string | number }[] = []
      for (const statusIdChunk of chunkArray(
        uniqueStatusIds,
        getWhereInBatchSize(database, 1)
      )) {
        const chunkRows = await database('status_pins')
          .where({ actorId })
          .whereIn('statusId', statusIdChunk)
          .select<{ statusId: string; createdAt: Date | string | number }[]>(
            'statusId',
            'createdAt'
          )
        rows.push(...chunkRows)
      }

      return rows
        .sort((a, b) => {
          const timeA = new Date(a.createdAt).getTime()
          const timeB = new Date(b.createdAt).getTime()
          if (timeA !== timeB) return timeB - timeA
          return b.statusId.localeCompare(a.statusId)
        })
        .map((row) => row.statusId)
    }

    let query = database('status_pins').where({ actorId })

    const rows = await query
      .select<{ statusId: string }[]>('statusId')
      .orderBy('createdAt', 'desc')
      .orderBy('statusId', 'desc')
    return rows.map((row) => row.statusId)
  }

  async function getStatusesByIds({
    statusIds,
    currentActorId,
    visibleToActorId,
    withReplies
  }: GetStatusesByIdsParams): Promise<Status[]> {
    if (statusIds.length === 0) {
      return []
    }

    const uniqueStatusIds = [...new Set(statusIds)]
    let query = database('statuses').whereIn('id', uniqueStatusIds)
    if (visibleToActorId) {
      query = applyPotentiallyReadableStatusFilter({
        query,
        visibleToActorId
      })
    }
    const statuses = await query.select()
    const hydrationContext: StatusHydrationContext = {}
    const hydrationStatusIds = await collectHydrationStatusIds(statuses)
    const hasHydrationStatusIds = hydrationStatusIds.size > 0
    // Detected language is viewer-independent, so it's batched for every
    // fetch (not just signed-in viewers) to avoid falling back to a
    // per-status query in getStatusWithAttachmentsFromData. Run it in the
    // same Promise.all as the bookmark/like queries below rather than
    // sequentially, so all three independent batched lookups overlap.
    const [detectedLanguages, bookmarkRows, likeRows] = await Promise.all([
      hasHydrationStatusIds
        ? statusDetectedLanguageDatabase.getDetectedLanguages({
            statusIds: [...hydrationStatusIds]
          })
        : Promise.resolve({}),
      currentActorId && hasHydrationStatusIds
        ? database('bookmarks')
            .where('actorId', currentActorId)
            .whereIn('statusId', [...hydrationStatusIds])
            .select<{ statusId: string }[]>('statusId')
        : Promise.resolve([]),
      currentActorId && hasHydrationStatusIds
        ? database('likes')
            .where('actorId', currentActorId)
            .whereIn('statusId', [...hydrationStatusIds])
            .select<{ statusId: string }[]>('statusId')
        : Promise.resolve([])
    ])
    hydrationContext.detectedLanguages = detectedLanguages
    if (currentActorId) {
      hydrationContext.bookmarkedStatusIds = new Set(
        bookmarkRows.map((row) => row.statusId)
      )
      hydrationContext.likedStatusIds = new Set(
        likeRows.map((row) => row.statusId)
      )
    }
    const statusMap = new Map(
      statuses.map((statusData) => [statusData.id, statusData] as const)
    )
    const orderedStatusData = statusIds
      .map((statusId) => statusMap.get(statusId))
      .filter((statusData) => Boolean(statusData))
    const statusesWithAttachments = (
      await Promise.all(
        orderedStatusData.map((statusData) =>
          getStatusWithAttachmentsFromData(
            statusData,
            currentActorId,
            withReplies,
            hydrationContext
          )
        )
      )
    ).filter((status): status is Status => status !== null)

    return statusesWithAttachments
  }

  async function collectHydrationStatusIds(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    statuses: any[]
  ): Promise<Set<string>> {
    const statusIds = new Set<string>()
    const seen = new Set<string>()
    let pending = statuses

    for (
      let depth = 0;
      pending.length > 0 && depth <= MAX_ANNOUNCE_RESOLUTION_DEPTH;
      depth += 1
    ) {
      const originalStatusIds: string[] = []
      for (const statusData of pending) {
        if (seen.has(statusData.id)) continue
        seen.add(statusData.id)

        if (statusData.type === StatusType.enum.Announce) {
          const originalStatusId = getAnnounceOriginalStatusId(statusData)
          if (originalStatusId) originalStatusIds.push(originalStatusId)
        } else {
          statusIds.add(statusData.id)
        }
      }

      const missingOriginalStatusIds = [
        ...new Set(originalStatusIds.filter((statusId) => !seen.has(statusId)))
      ]
      pending =
        missingOriginalStatusIds.length > 0
          ? await database('statuses')
              .whereIn('id', missingOriginalStatusIds)
              .select()
          : []
    }

    return statusIds
  }

  const addCounterAdjustment = (
    adjustments: Map<string, number>,
    counterKey: string,
    amount = 1
  ) => {
    adjustments.set(counterKey, (adjustments.get(counterKey) ?? 0) + amount)
  }

  const selectStatusDeletionRowsByIds = async (
    trx: Knex.Transaction,
    statusIds: string[]
  ) => {
    const rows: StatusDeletionRow[] = []
    for (const statusIdChunk of chunkArray(
      statusIds,
      getWhereInBatchSize(trx)
    )) {
      rows.push(
        ...(await trx('statuses')
          .whereIn('id', statusIdChunk)
          .select<StatusDeletionRow[]>(
            'id',
            'actorId',
            'type',
            'reply',
            'content',
            'originalStatusId'
          ))
      )
    }
    return rows
  }

  const selectReplyIdsByStatusIds = async (
    trx: Knex.Transaction,
    statusIds: string[]
  ) => {
    // Reply traversal stays on statuses.reply, which is indexed by migration.
    const rows: { id: string }[] = []
    for (const statusIdChunk of chunkArray(
      statusIds,
      getWhereInBatchSize(trx)
    )) {
      rows.push(
        ...(await trx('statuses')
          .whereIn('reply', statusIdChunk)
          .select<{ id: string }[]>('id'))
      )
    }
    return rows
  }

  const statusActorMatches = (statusActorId: string, actorId: string) => {
    const normalizedStatusActorId = normalizeActorId(statusActorId)
    const normalizedExpectedActorId = normalizeActorId(actorId)
    return (
      normalizedStatusActorId !== null &&
      normalizedExpectedActorId !== null &&
      normalizedStatusActorId === normalizedExpectedActorId
    )
  }

  const selectLocalActorIds = async (
    trx: Knex.Transaction,
    actorIds: string[]
  ) => {
    const localActorIds = new Set<string>()
    for (const actorIdChunk of chunkArray(actorIds, getWhereInBatchSize(trx))) {
      const rows = await trx('actors')
        .whereIn('id', actorIdChunk)
        .whereNotNull('accountId')
        .select<{ id: string }[]>('id')
      for (const row of rows) {
        localActorIds.add(row.id)
      }
    }
    return localActorIds
  }

  const resolveParentStatusIdsByReplyReferences = async (
    trx: Knex.Transaction,
    replyReferences: string[]
  ) => {
    const referenceToStatusId = new Map<string, string>()
    const uniqueReplyReferences = [
      ...new Set(replyReferences.filter((reply) => reply.length > 0))
    ]
    const batchSize = Math.max(1, Math.floor(getWhereInBatchSize(trx) / 3))

    for (const replyReferenceChunk of chunkArray(
      uniqueReplyReferences,
      batchSize
    )) {
      const replyReferenceHashes = replyReferenceChunk.map((reply) =>
        getStatusUrlHash(reply)
      )
      const rows = await trx('statuses')
        .whereIn('id', replyReferenceChunk)
        .orWhere((builder) =>
          builder
            .whereIn('urlHash', replyReferenceHashes)
            .whereIn('url', replyReferenceChunk)
        )
        .select<{ id: string; url: string | null }[]>('id', 'url')

      for (const row of rows) {
        referenceToStatusId.set(row.id, row.id)
        if (row.url) {
          referenceToStatusId.set(row.url, row.id)
        }
      }
    }

    return referenceToStatusId
  }

  const applyStatusDeletionCounterAdjustments = async ({
    currentTime,
    statuses,
    trx
  }: {
    currentTime: Date
    statuses: StatusDeletionRow[]
    trx: Knex.Transaction
  }) => {
    const adjustments = new Map<string, number>()
    const localActorIds = await selectLocalActorIds(trx, [
      ...new Set(statuses.map((status) => status.actorId))
    ])
    const parentStatusIdByReplyReference =
      await resolveParentStatusIdsByReplyReferences(
        trx,
        statuses
          .map((status) => status.reply ?? '')
          .filter((reply) => reply.length > 0)
      )

    for (const status of statuses) {
      addCounterAdjustment(adjustments, CounterKey.totalStatus(status.actorId))
      addCounterAdjustment(adjustments, CounterKey.serviceTotalStatuses())
      if (localActorIds.has(status.actorId)) {
        addCounterAdjustment(adjustments, CounterKey.nodeinfoLocalPosts())
      }

      if (status.type === StatusType.enum.Announce) {
        const originalStatusId = getAnnounceOriginalStatusId(status)
        if (originalStatusId) {
          addCounterAdjustment(
            adjustments,
            CounterKey.totalReblog(originalStatusId)
          )
        }
      }

      if (status.reply) {
        const parentStatusId = parentStatusIdByReplyReference.get(status.reply)
        if (parentStatusId) {
          addCounterAdjustment(
            adjustments,
            CounterKey.totalReply(parentStatusId)
          )
        }
      }
    }

    for (const [counterKey, amount] of adjustments) {
      await decreaseCounterValue(trx, counterKey, amount, currentTime)
    }
  }

  const applyHashtagDeletionCounterAdjustments = async ({
    currentTime,
    tags,
    trx
  }: {
    currentTime: Date
    tags: StatusHashtagTagRow[]
    trx: Knex.Transaction
  }) => {
    const adjustments = new Map<string, number>()

    for (const tag of tags) {
      const tagName = normalizeHashtagSearchName(tag.name)
      addCounterAdjustment(adjustments, CounterKey.totalHashtag(tagName))
    }

    for (const [counterKey, amount] of adjustments) {
      await decreaseCounterValue(trx, counterKey, amount, currentTime)
    }
  }

  const collectStatusDeletionRows = async ({
    actorId,
    statusId,
    trx
  }: DeleteStatusParams & {
    trx: Knex.Transaction
  }) => {
    const levels: StatusDeletionRow[][] = []
    const seen = new Set<string>([statusId])
    let currentStatusIds = [statusId]

    for (let depth = 0; currentStatusIds.length > 0; depth += 1) {
      if (depth >= MAX_STATUS_REPLY_DELETE_DEPTH) {
        throw statusReplyDeletionDepthError(statusId)
      }

      let rows = await selectStatusDeletionRowsByIds(trx, currentStatusIds)
      const rowsToDelete = actorId
        ? rows.filter((row) => statusActorMatches(row.actorId, actorId))
        : rows
      if (actorId) {
        if (depth === 0 && !rowsToDelete.some((row) => row.id === statusId)) {
          return []
        }
      }

      if (rows.length === 0) {
        currentStatusIds = []
        continue
      }

      if (rowsToDelete.length > 0) {
        levels.push(rowsToDelete)
      }

      const replies = await selectReplyIdsByStatusIds(
        trx,
        rows.map((row) => row.id)
      )
      const nextStatusIds: string[] = []

      for (const { id: replyId } of replies) {
        if (!seen.has(replyId)) {
          seen.add(replyId)
          nextStatusIds.push(replyId)
        }
      }

      currentStatusIds = nextStatusIds
    }

    return levels.reverse().flat()
  }

  const chunkStatusDeletionRows = ({
    actorId,
    statuses,
    trx
  }: {
    actorId?: string
    statuses: StatusDeletionRow[]
    trx: Knex.Transaction
  }) => {
    const maxBindings = getWhereInBatchSize(trx)
    if (!actorId) return chunkArray(statuses, maxBindings)

    const chunks: StatusDeletionRow[][] = []
    let currentChunk: StatusDeletionRow[] = []
    let currentActorIds = new Set<string>()

    for (const status of statuses) {
      const nextActorIdCount =
        currentActorIds.size + (currentActorIds.has(status.actorId) ? 0 : 1)
      const nextBindingCount = currentChunk.length + 1 + nextActorIdCount

      if (currentChunk.length > 0 && nextBindingCount > maxBindings) {
        chunks.push(currentChunk)
        currentChunk = []
        currentActorIds = new Set<string>()
      }

      currentChunk.push(status)
      currentActorIds.add(status.actorId)
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk)
    }

    return chunks
  }

  const deleteStatusRowsByIdChunks = async ({
    actorId,
    statuses,
    trx
  }: {
    actorId?: string
    statuses: StatusDeletionRow[]
    trx: Knex.Transaction
  }) => {
    for (const statusChunk of chunkStatusDeletionRows({
      actorId,
      statuses,
      trx
    })) {
      const query = trx('statuses').whereIn(
        'id',
        statusChunk.map((status) => status.id)
      )
      if (actorId) {
        query.whereIn('actorId', [
          ...new Set(statusChunk.map((status) => status.actorId))
        ])
      }
      await query.delete()
    }
  }

  async function deleteStatus({
    actorId,
    affectedHashtags,
    statusId,
    trx
  }: DeleteStatusParams & {
    affectedHashtags?: string[]
    trx?: Knex.Transaction
  }) {
    if (!trx) {
      const collectedHashtags: string[] = []
      await database.transaction(async (trx) => {
        await deleteStatus({
          actorId,
          affectedHashtags: collectedHashtags,
          statusId,
          trx
        })
      })
      if (collectedHashtags.length > 0) {
        // Keep hashtag aggregate writes outside the delete transaction. A full
        // reindexSearchHashtags run can reconcile this if the process exits
        // after commit and before this best-effort refresh completes.
        try {
          await indexHashtagSearchDocuments(database, {
            hashtags: [...new Set(collectedHashtags)]
          })
        } catch (err) {
          logger.warn(
            {
              err,
              hashtags: [...new Set(collectedHashtags)],
              statusId
            },
            'Failed to refresh hashtag search documents after status deletion'
          )
        }
      }
      return
    }

    const statusesToDelete = await collectStatusDeletionRows({
      actorId,
      statusId,
      trx
    })
    if (statusesToDelete.length === 0) return

    const currentTime = new Date()
    const statusIdsToDelete = statusesToDelete.map((status) => status.id)
    await applyStatusDeletionCounterAdjustments({
      currentTime,
      statuses: statusesToDelete,
      trx
    })

    const hashtagTags = await selectHashtagTagsByStatusIds(
      trx,
      statusIdsToDelete
    )
    await applyHashtagDeletionCounterAdjustments({
      currentTime,
      tags: hashtagTags,
      trx
    })
    affectedHashtags?.push(...hashtagTags.map((tag) => tag.name))

    await deleteRowsByColumnChunks(
      trx,
      'recipients',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(trx, 'likes', 'statusId', statusIdsToDelete)
    await deleteRowsByColumnChunks(trx, 'tags', 'statusId', statusIdsToDelete)
    await deleteRowsByColumnChunks(
      trx,
      'attachments',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'bookmarks',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'status_pins',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'status_history',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'poll_answers',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'poll_voters',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'poll_choices',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'timelines',
      'statusId',
      statusIdsToDelete
    )
    // Mirror the `timelines` cleanup for the collection fan-out feed so deleting
    // a status does not leave orphaned rows in the high-row-count
    // `collection_timeline` table (matching the materialized-timeline pattern
    // rather than a DB foreign key, which the sibling `timelines` table also
    // does not use).
    await deleteRowsByColumnChunks(
      trx,
      'collection_timeline',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'notifications',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'direct_conversation_statuses',
      'statusId',
      statusIdsToDelete
    )
    // Clean up idempotency keys that pointed at the deleted status so a retried
    // create with the same key does not resolve to a now-missing status (which
    // would otherwise let the retry create a duplicate). Likewise drop any
    // conversation mute rows keyed on a deleted thread root.
    await deleteRowsByColumnChunks(
      trx,
      'idempotency_keys',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'status_mutes',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'status_detected_languages',
      'statusId',
      statusIdsToDelete
    )
    for (const statusIdChunk of chunkArray(
      statusIdsToDelete,
      getWhereInBatchSize(trx)
    )) {
      await trx('fitness_files')
        .whereIn('statusId', statusIdChunk)
        .update({ statusId: null })
    }
    await deleteStatusRowsByIdChunks({
      actorId,
      statuses: statusesToDelete,
      trx
    })
    await deleteStatusSearchDocumentsByStatusIds(trx, statusIdsToDelete)
    await deleteCounterValues(
      trx,
      statusIdsToDelete.flatMap((statusId) => [
        CounterKey.totalLike(statusId),
        CounterKey.totalReblog(statusId),
        CounterKey.totalReply(statusId)
      ])
    )
  }

  async function getFavouritedBy({
    statusId,
    limit,
    maxId,
    minId,
    sinceId
  }: GetFavouritedByParams): Promise<FavouritedByAccount[]> {
    const olderCursorToken = maxId
    const newerCursorToken = minId || sinceId

    // Reject malformed cursors with an empty page instead of scanning from the
    // top, matching the favourites/bookmarks pagination contract.
    if (
      (olderCursorToken && !decodeFavouritedByCursor(olderCursorToken)) ||
      (newerCursorToken && !decodeFavouritedByCursor(newerCursorToken))
    ) {
      return []
    }

    const applyCursor = (
      builder: Knex.QueryBuilder,
      cursor: { createdAt: number; actorId: string },
      direction: 'newer' | 'older'
    ) => {
      const operator = direction === 'older' ? '<' : '>'
      const createdAtValue = new Date(cursor.createdAt)
      builder.andWhere((inner) => {
        inner
          .where('createdAt', operator, createdAtValue)
          .orWhere((tieBreaker) => {
            tieBreaker
              .where('createdAt', createdAtValue)
              .andWhere('actorId', operator, cursor.actorId)
          })
      })
    }

    const query = database('likes').where({ statusId }).limit(limit)

    const olderCursor = decodeFavouritedByCursor(olderCursorToken)
    if (olderCursor) applyCursor(query, olderCursor, 'older')

    const newerCursor = decodeFavouritedByCursor(newerCursorToken)
    if (newerCursor) applyCursor(query, newerCursor, 'newer')

    if (minId) {
      query.orderBy('createdAt', 'asc').orderBy('actorId', 'asc')
    } else {
      query.orderBy('createdAt', 'desc').orderBy('actorId', 'desc')
    }

    const rows = await query
    const ordered = minId ? rows.reverse() : rows
    return ordered.map((row) => ({
      actorId: row.actorId,
      createdAt: getCompatibleTime(row.createdAt)
    }))
  }

  async function getRebloggedBy({
    statusId,
    limit,
    maxStatusId,
    minStatusId,
    sinceStatusId,
    visibleToActorId
  }: GetRebloggedByParams) {
    const reblogBase = database('statuses')
      .where('type', StatusType.enum.Announce)
      .where((builder) => {
        builder.where('originalStatusId', statusId).orWhere((legacyBuilder) => {
          legacyBuilder.whereNull('originalStatusId').where('content', statusId)
        })
      })
    const reblogTargetStatusIds = reblogBase.clone().select('id')

    let visibleReblogsQuery = reblogBase
      .clone()
      .select('statuses.id', 'statuses.actorId', 'statuses.createdAt')

    visibleReblogsQuery = visibleToActorId
      ? applyPotentiallyReadableStatusFilter({
          query: visibleReblogsQuery,
          visibleToActorId
        })
      : applyPublicReadableStatusFilter({
          query: visibleReblogsQuery,
          targetStatusIds: reblogTargetStatusIds
        })

    const dedupedReblogsQuery = database
      .select<{ id: string; actorId: string; createdAt: Date }[]>(
        'visible_reblogs.id',
        'visible_reblogs.actorId',
        'visible_reblogs.createdAt'
      )
      .from(visibleReblogsQuery.clone().as('visible_reblogs'))
      .whereNotExists(function () {
        this.select(database.raw('1'))
          .from(visibleReblogsQuery.clone().as('newer_reblogs'))
          .whereRaw('?? = ??', [
            'newer_reblogs.actorId',
            'visible_reblogs.actorId'
          ])
          .where((builder) => {
            builder
              .whereRaw('?? > ??', [
                'newer_reblogs.createdAt',
                'visible_reblogs.createdAt'
              ])
              .orWhere((sameTimestampBuilder) => {
                sameTimestampBuilder
                  .whereRaw('?? = ??', [
                    'newer_reblogs.createdAt',
                    'visible_reblogs.createdAt'
                  ])
                  .whereRaw('?? > ??', [
                    'newer_reblogs.id',
                    'visible_reblogs.id'
                  ])
              })
          })
      })

    const [maxCursor, minCursor, sinceCursor] = await Promise.all([
      maxStatusId
        ? visibleReblogsQuery.clone().where('statuses.id', maxStatusId).first<{
            id: string
            createdAt: Date
          }>('statuses.id', 'statuses.createdAt')
        : null,
      minStatusId
        ? visibleReblogsQuery.clone().where('statuses.id', minStatusId).first<{
            id: string
            createdAt: Date
          }>('statuses.id', 'statuses.createdAt')
        : null,
      sinceStatusId
        ? visibleReblogsQuery
            .clone()
            .where('statuses.id', sinceStatusId)
            .first<{
              id: string
              createdAt: Date
            }>('statuses.id', 'statuses.createdAt')
        : null
    ])
    if (maxStatusId && !maxCursor) return []
    if (minStatusId && !minCursor) return []
    if (sinceStatusId && !sinceCursor) return []

    let query = dedupedReblogsQuery.clone()
    if (minStatusId) {
      query = query.orderBy('createdAt', 'asc').orderBy('id', 'asc')
    } else {
      query = query.orderBy('createdAt', 'desc').orderBy('id', 'desc')
    }

    if (maxCursor) {
      query = query.where((builder) => {
        builder
          .where('createdAt', '<', maxCursor.createdAt)
          .orWhere((sameTimestampBuilder) => {
            sameTimestampBuilder
              .where('createdAt', maxCursor.createdAt)
              .where('id', '<', maxCursor.id)
          })
      })
    }

    if (minCursor) {
      query = query.where((builder) => {
        builder
          .where('createdAt', '>', minCursor.createdAt)
          .orWhere((sameTimestampBuilder) => {
            sameTimestampBuilder
              .where('createdAt', minCursor.createdAt)
              .where('id', '>', minCursor.id)
          })
      })
    }

    if (sinceCursor) {
      query = query.where((builder) => {
        builder
          .where('createdAt', '>', sinceCursor.createdAt)
          .orWhere((sameTimestampBuilder) => {
            sameTimestampBuilder
              .where('createdAt', sinceCursor.createdAt)
              .where('id', '>', sinceCursor.id)
          })
      })
    }

    if (typeof limit === 'number') {
      query = query.limit(limit)
    }

    const result = await query
    const ordered = minStatusId ? result.reverse() : result
    return ordered.map((item) => ({
      actorId: item.actorId,
      statusId: item.id
    }))
  }

  async function createTag({
    statusId,
    name,
    value,
    type,
    skipSearchIndex = false
  }: CreateTagParams): Promise<Tag> {
    const currentTime = new Date()

    const data = Tag.parse({
      id: crypto.randomUUID(),
      statusId,
      type,
      name,
      value: value || '',
      createdAt: getCompatibleTime(currentTime),
      updatedAt: getCompatibleTime(currentTime)
    })
    await database('tags').insert({
      ...data,
      ...(type === 'hashtag'
        ? { nameNormalized: `#${normalizeHashtagSearchName(name)}` }
        : undefined),
      createdAt: currentTime,
      updatedAt: currentTime
    })
    if (type === 'hashtag' && !skipSearchIndex) {
      // Hashtag search stores an aggregate across all public statuses for the
      // tag, so the inserted row alone is not enough to update the document.
      await indexHashtagSearchDocument(database, { hashtag: name })
    }
    return data
  }

  async function getTags({ statusId }: GetTagsParams) {
    const data = await database<Tag>('tags').where('statusId', statusId)
    return data.map((item) =>
      Tag.parse({
        ...item,
        createdAt: getCompatibleTime(item.createdAt),
        updatedAt: getCompatibleTime(item.updatedAt)
      })
    )
  }

  async function deleteStatusTagsByType({
    statusId,
    type
  }: DeleteStatusTagsByTypeParams) {
    await database('tags').where({ statusId, type }).delete()
  }

  function getHashtagLookupNames(hashtag: string): string[] {
    const bare = normalizeHashtagSearchName(hashtag)
    return bare ? [bare, `#${bare}`] : []
  }

  async function getStatusesByHashtag({
    hashtag,
    limit = PER_PAGE_LIMIT,
    maxStatusId
  }: GetStatusesByHashtagParams): Promise<Status[]> {
    const normalizedNames = getHashtagLookupNames(hashtag)
    let query = database('tags')
      .innerJoin('statuses', 'tags.statusId', 'statuses.id')
      .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
      .where('tags.type', 'hashtag')
      .whereIn('tags.nameNormalized', normalizedNames)
      .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
      .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])
      .select('statuses.id', 'statuses.createdAt')
      .distinct()
      .orderBy('statuses.createdAt', 'desc')
      .orderBy('statuses.id', 'desc')
      .limit(limit)

    if (maxStatusId) {
      const cursor = await database('statuses')
        .where('id', maxStatusId)
        .select('createdAt')
        .first<{ createdAt: Date }>()
      if (cursor) {
        query = query.where((wb) => {
          wb.where('statuses.createdAt', '<', cursor.createdAt).orWhere(
            (wb2) => {
              wb2
                .where('statuses.createdAt', '=', cursor.createdAt)
                .where('statuses.id', '<', maxStatusId)
            }
          )
        })
      }
    }

    const rows = await query
    const statusIds = rows.map((row: { id: string }) => row.id)
    if (statusIds.length === 0) return []
    return getStatusesByIds({ statusIds })
  }

  async function getHashtagCounter({
    hashtag
  }: {
    hashtag: string
  }): Promise<number> {
    const tagName = normalizeHashtagSearchName(hashtag)
    return getCounterValue(database, CounterKey.totalHashtag(tagName))
  }

  async function getHashtagStatusesPage({
    hashtag,
    limit,
    offset
  }: GetHashtagStatusesPageParams) {
    const normalizedNames = getHashtagLookupNames(hashtag)
    const baseQuery = () =>
      database('tags')
        .innerJoin('statuses', 'tags.statusId', 'statuses.id')
        .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
        .where('tags.type', 'hashtag')
        .whereIn('tags.nameNormalized', normalizedNames)
        .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
        .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])

    const [rows, countResult] = await Promise.all([
      baseQuery()
        .distinct('statuses.id', 'statuses.createdAt')
        .orderBy('statuses.createdAt', 'desc')
        .orderBy('statuses.id', 'desc')
        .limit(limit)
        .offset(offset),
      baseQuery()
        .countDistinct<{ count: string }>({ count: 'statuses.id' })
        .first()
    ])

    const statusIds = (rows as { id: string }[]).map((row) => row.id)
    const statuses =
      statusIds.length > 0 ? await getStatusesByIds({ statusIds }) : []
    return {
      statuses,
      total: parseInt(String(countResult?.count ?? '0'), 10)
    }
  }

  async function increaseHashtagCounter({
    hashtag
  }: {
    hashtag: string
  }): Promise<void> {
    const tagName = normalizeHashtagSearchName(hashtag)
    await increaseCounterValue(database, CounterKey.totalHashtag(tagName))
  }

  async function decreaseHashtagCounter({
    hashtag
  }: {
    hashtag: string
  }): Promise<void> {
    const tagName = normalizeHashtagSearchName(hashtag)
    await decreaseCounterValue(database, CounterKey.totalHashtag(tagName))
  }

  // Private
  async function getPollChoices(statusId: string) {
    const raw = await database('poll_choices')
      .where('statusId', statusId)
      .orderBy('choiceId', 'asc')
    return raw.map((data) =>
      PollChoice.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    )
  }

  async function getPollVotersCount(statusId: string): Promise<number> {
    const result = await database('poll_voters')
      .where('statusId', statusId)
      .count<{ count: string }>('* as count')
      .first()
    return parseInt(String(result?.count ?? '0'), 10)
  }

  async function getStatusWithAttachmentsFromData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    currentActorId?: string,
    withReplies?: boolean,
    hydrationContext: StatusHydrationContext = {}
  ): Promise<Status | null> {
    const [to, cc] = await Promise.all([
      database('recipients').where('statusId', data.id).andWhere('type', 'to'),
      database('recipients').where('statusId', data.id).andWhere('type', 'cc')
    ])

    if (data.type === StatusType.enum.Announce) {
      const originalStatusId = getAnnounceOriginalStatusId(data)
      if (!originalStatusId) return null
      const [actor, originalStatus] = await Promise.all([
        actorDatabase.getActorFromId({ id: data.actorId }),
        getStatusWithHydration({
          statusId: originalStatusId,
          currentActorId,
          hydrationContext
        })
      ])
      if (!originalStatus) return null
      return StatusAnnounce.parse({
        id: data.id,
        actorId: data.actorId,
        actor: actor ? getActorProfile(actor) : null,
        type: StatusType.enum.Announce,
        to: to.map((item) => item.actorId),
        cc: cc.map((item) => item.actorId),
        edits: [],
        originalStatus: originalStatus as StatusNote,
        isLocalActor: Boolean(actor?.account),
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    }

    const [
      attachments,
      tags,
      replies,
      actor,
      totalLikes,
      totalShares,
      isActorLikedStatusResult,
      isActorBookmarkedStatusResult,
      actorAnnounceStatus,
      edits,
      fitnessFile,
      detectedLanguage
    ] = await Promise.all([
      mediaDatabase.getAttachments({ statusId: data.id }),
      getTags({ statusId: data.id }),
      withReplies
        ? database('statuses')
            .select('id')
            .where('reply', data.id)
            .orderBy('createdAt', 'desc')
        : Promise.resolve([]),
      actorDatabase.getActorFromId({ id: data.actorId }),
      getCounterValue(database, CounterKey.totalLike(data.id)),
      getCounterValue(database, CounterKey.totalReblog(data.id)),
      currentActorId
        ? hydrationContext.likedStatusIds
          ? hydrationContext.likedStatusIds.has(data.id)
          : likeDatabase.isActorLikedStatus({
              statusId: data.id,
              actorId: currentActorId
            })
        : false,
      currentActorId
        ? hydrationContext.bookmarkedStatusIds
          ? hydrationContext.bookmarkedStatusIds.has(data.id)
          : bookmarkDatabase.isActorBookmarkedStatus({
              statusId: data.id,
              actorId: currentActorId,
              statusType: data.type
            })
        : false,
      currentActorId
        ? getActorAnnounceStatus({
            statusId: data.id,
            actorId: currentActorId
          })
        : null,
      database('status_history').where('statusId', data.id),
      // A status can carry several fitness files (e.g. the same ride merged
      // from two devices). Surface the primary one — matching
      // getFitnessFileByStatus — instead of an arbitrary `.first()`.
      database<SQLFitnessFile>('fitness_files')
        .where('statusId', data.id)
        .whereNull('deletedAt')
        .orderBy('isPrimary', 'desc')
        .orderBy('activityStartTime', 'asc')
        .orderBy('createdAt', 'asc')
        .first(),
      hydrationContext?.detectedLanguages
        ? (hydrationContext.detectedLanguages[data.id] ?? null)
        : statusDetectedLanguageDatabase.getDetectedLanguage({
            statusId: data.id
          })
    ])

    const repliesNote = (
      await Promise.all(replies.map((item) => getStatus({ statusId: item.id })))
    )
      .map((item) =>
        item?.type &&
        [StatusType.enum.Note, StatusType.enum.Poll].includes(
          item?.type as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
          ? item
          : null
      )
      .filter((item): item is StatusNote => Boolean(item))
    const orderedAttachments = sortAttachmentsForFitnessMap(
      attachments,
      fitnessFile?.mapImagePath
    )

    const content = getCompatibleJSON(data.content)
    const base = {
      id: data.id,
      url: content.url ?? data.url,
      to: to.map((item) => item.actorId),
      cc: cc.map((item) => item.actorId),
      actorId: data.actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: data.type,
      text: content.text,
      summary: content.summary,
      sensitive: content.sensitive ?? false,
      language: content.language ?? null,
      detectedLanguage,
      applicationName: data.applicationName ?? null,
      applicationWebsite: data.applicationWebsite ?? null,
      reply: data.reply,
      replies: repliesNote,
      totalLikes,
      totalShares,
      isActorLiked: isActorLikedStatusResult,
      isActorBookmarked: isActorBookmarkedStatusResult,
      actorAnnounceStatusId: actorAnnounceStatus?.id ?? null,
      isLocalActor: Boolean(actor?.account),
      attachments: orderedAttachments,
      tags,
      ...(fitnessFile
        ? {
            fitness: {
              id: fitnessFile.id,
              fileName: fitnessFile.fileName,
              fileType: fitnessFile.fileType,
              mimeType: fitnessFile.mimeType,
              bytes: Number(fitnessFile.bytes),
              url: `/api/v1/fitness-files/${fitnessFile.id}`,
              processingStatus: fitnessFile.processingStatus ?? 'pending',
              // True when the file has sat in `processing` long enough that the
              // worker must have died mid-job. Lets clients offer a retry
              // instead of an endless spinner. Computed server-side so the
              // client never does time math (avoids hydration drift).
              processingStuck: isFitnessProcessingStuck(
                {
                  processingStatus: fitnessFile.processingStatus,
                  updatedAt: getCompatibleTime(fitnessFile.updatedAt)
                },
                Date.now()
              ),
              ...(typeof fitnessFile.totalDistanceMeters === 'number'
                ? { totalDistanceMeters: fitnessFile.totalDistanceMeters }
                : null),
              ...(typeof fitnessFile.totalDurationSeconds === 'number'
                ? { totalDurationSeconds: fitnessFile.totalDurationSeconds }
                : null),
              ...(typeof fitnessFile.elevationGainMeters === 'number'
                ? { elevationGainMeters: fitnessFile.elevationGainMeters }
                : null),
              ...(fitnessFile.activityType
                ? { activityType: fitnessFile.activityType }
                : null),
              hasMapData: Boolean(fitnessFile.hasMapData),
              ...(fitnessFile.description
                ? { description: fitnessFile.description }
                : null),
              ...(fitnessFile.deviceManufacturer
                ? { deviceManufacturer: fitnessFile.deviceManufacturer }
                : null),
              ...(fitnessFile.deviceName
                ? { deviceName: fitnessFile.deviceName }
                : null),
              ...(fitnessFile.sourceUrl
                ? { sourceUrl: fitnessFile.sourceUrl }
                : null)
            }
          }
        : null),
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt),

      edits: edits.map((item) => {
        const content = getCompatibleJSON(item.data)
        return {
          text: content.text,
          summary: content.summary ?? null,
          createdAt: getCompatibleTime(item.createdAt)
        }
      })
    }
    if (data.type === StatusType.enum.Poll) {
      const [pollChoices, votersCount, voted, ownVotes] = await Promise.all([
        getPollChoices(data.id),
        getPollVotersCount(data.id),
        currentActorId
          ? hasActorVoted({ statusId: data.id, actorId: currentActorId })
          : false,
        currentActorId
          ? getActorPollVotes({ statusId: data.id, actorId: currentActorId })
          : []
      ])
      return StatusPoll.parse({
        ...base,
        choices: pollChoices,
        // Coerce to a finite timestamp; guards legacy/corrupt rows where endAt
        // may be missing or a non-numeric value (see coercePollEndAt). Falls
        // back to the status creation time (stable across reads) rather than
        // Date.now() so hydration stays deterministic.
        endAt: coercePollEndAt(content.endAt, base.createdAt),
        pollType: content.pollType ?? 'oneOf',
        votersCount,
        voted,
        ownVotes
      })
    }

    return StatusNote.parse(base)
  }

  async function getStatusReblogsCount({
    statusId
  }: GetStatusReblogsCountParams): Promise<number> {
    return getCounterValue(database, CounterKey.totalReblog(statusId))
  }

  async function getStatusCounterValues(
    { statusIds }: GetStatusCountsParams,
    getCounterId: (statusId: string) => string
  ): Promise<Record<string, number>> {
    const uniqueStatusIds = [...new Set(statusIds)]
    const counterIdsByStatusId = new Map(
      uniqueStatusIds.map((statusId) => [statusId, getCounterId(statusId)])
    )
    const counterValueRows = await Promise.all(
      chunkArray(
        [...counterIdsByStatusId.values()],
        getWhereInBatchSize(database)
      ).map((counterIds) => getCounterValues(database, counterIds))
    )
    const counterValues = Object.assign({}, ...counterValueRows) as Record<
      string,
      number
    >

    return Object.fromEntries(
      uniqueStatusIds.map((statusId) => [
        statusId,
        counterValues[counterIdsByStatusId.get(statusId) ?? ''] ?? 0
      ])
    )
  }

  async function getStatusReblogsCounts(
    params: GetStatusCountsParams
  ): Promise<Record<string, number>> {
    return getStatusCounterValues(params, CounterKey.totalReblog)
  }

  async function getStatusRepliesCount({
    statusId,
    url,
    publicOnly = false
  }: GetStatusRepliesCountParams): Promise<number> {
    if (!url && !publicOnly) {
      return getCounterValue(database, CounterKey.totalReply(statusId))
    }

    let query = database('statuses').where((builder) => {
      builder.where('reply', statusId)
      if (url) {
        builder.orWhere('reply', url)
      }
    })

    if (publicOnly) {
      query = applyPublicReadableStatusFilter({
        query,
        targetStatusIds: getReplyTargetStatusIds({ statusId, url })
      })
    }

    const result = await query
      .whereNot('type', StatusType.enum.Announce)
      .count<{ count: string }>('* as count')
      .first()

    return parseInt(String(result?.count ?? '0'), 10)
  }

  async function getStatusRepliesCounts(
    params: GetStatusCountsParams
  ): Promise<Record<string, number>> {
    return getStatusCounterValues(params, CounterKey.totalReply)
  }

  async function recordPollVotes({
    statusId,
    actorId,
    choices,
    allowAdditionalChoices = false
  }: RecordPollVotesParams): Promise<boolean> {
    const uniqueChoices = [...new Set(choices)]
    if (uniqueChoices.length === 0) return false

    const currentTime = new Date()
    try {
      return await database.transaction(async (trx) => {
        const pollChoices = await trx('poll_choices')
          .where({ statusId })
          .orderBy('choiceId', 'asc')
          .select<{ choiceId: number }[]>('choiceId')
        const selectedChoices: { choiceIndex: number; choiceId: number }[] = []
        for (const choiceIndex of uniqueChoices) {
          const choice = pollChoices[choiceIndex]
          if (!choice) return false
          selectedChoices.push({
            choiceIndex,
            choiceId: choice.choiceId
          })
        }

        const existingVote = await trx('poll_voters')
          .where({ statusId, actorId })
          .first()
        if (existingVote && !allowAdditionalChoices) return false

        const existingAnswers = allowAdditionalChoices
          ? await trx('poll_answers')
              .where({ statusId, actorId })
              .whereIn('choice', uniqueChoices)
              .select<{ choice: number }[]>('choice')
          : []
        const existingChoices = new Set(
          existingAnswers.map((answer) => answer.choice)
        )
        const newSelectedChoices = selectedChoices.filter(
          (choice) => !existingChoices.has(choice.choiceIndex)
        )
        if (newSelectedChoices.length === 0) return false

        if (!existingVote) {
          await trx('poll_voters').insert({
            statusId,
            actorId,
            createdAt: currentTime,
            updatedAt: currentTime
          })
        }

        await trx('poll_answers').insert(
          newSelectedChoices.map((choice) => ({
            statusId,
            actorId,
            choice: choice.choiceIndex,
            createdAt: currentTime,
            updatedAt: currentTime
          }))
        )

        await trx('poll_choices')
          .where({ statusId })
          .whereIn(
            'choiceId',
            newSelectedChoices.map((choice) => choice.choiceId)
          )
          .increment('totalVotes', 1)

        return true
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) return false
      throw error
    }
  }

  async function createPollAnswer({
    statusId,
    actorId,
    choice
  }: CreatePollAnswerParams): Promise<void> {
    const currentTime = new Date()
    await database('poll_answers').insert({
      statusId,
      actorId,
      choice,
      createdAt: currentTime,
      updatedAt: currentTime
    })
  }

  async function hasActorVoted({
    statusId,
    actorId
  }: HasActorVotedParams): Promise<boolean> {
    const result = await database('poll_answers')
      .where({ statusId, actorId })
      .first()
    return Boolean(result)
  }

  async function getActorPollVotes({
    statusId,
    actorId
  }: GetActorPollVotesParams): Promise<number[]> {
    const results = await database('poll_answers')
      .where({ statusId, actorId })
      .select('choice')
    return results.map((r) => r.choice)
  }

  async function getActorPollVotesForStatuses({
    statusIds,
    actorId
  }: GetActorPollVotesForStatusesParams): Promise<Record<string, number[]>> {
    const uniqueStatusIds = [...new Set(statusIds)]
    const votesByStatusId = Object.fromEntries(
      uniqueStatusIds.map((statusId) => [statusId, []])
    ) as Record<string, number[]>

    for (const statusIdChunk of chunkArray(
      uniqueStatusIds,
      getWhereInBatchSize(database, 1)
    )) {
      const results = await database('poll_answers')
        .where('actorId', actorId)
        .whereIn('statusId', statusIdChunk)
        .select<{ statusId: string; choice: number }[]>('statusId', 'choice')
        .orderBy('statusId', 'asc')
        .orderBy('choice', 'asc')

      for (const result of results) {
        votesByStatusId[result.statusId]?.push(Number(result.choice))
      }
    }

    return votesByStatusId
  }

  async function incrementPollChoiceVotes({
    statusId,
    choiceIndex
  }: IncrementPollChoiceVotesParams): Promise<void> {
    const choice = await database('poll_choices')
      .where({ statusId })
      .orderBy('choiceId', 'asc')
      .offset(choiceIndex)
      .first<{ choiceId: number }>('choiceId')
    if (!choice) return

    await database('poll_choices')
      .where({ statusId, choiceId: choice.choiceId })
      .increment('totalVotes', 1)
  }

  async function getStatusFromUrl({ url }: GetStatusFromUrlParams) {
    const status = await database('statuses')
      .where('urlHash', getStatusUrlHash(url))
      .andWhere('url', url)
      .first<{ id: string }>('id')

    if (status?.id) {
      return getStatus({ statusId: status.id })
    }

    return null
  }

  async function getStatusFromUrlHash({
    urlHash,
    actorId
  }: GetStatusFromUrlHashParams) {
    const query = database('statuses').where('urlHash', urlHash)
    if (actorId) {
      query.andWhere('actorId', actorId)
    }

    const status = await query.first()
    if (!status) return null

    return getStatusWithAttachmentsFromData(status)
  }

  async function getActorAnnouncedStatusId({
    actorId,
    originalStatusId
  }: {
    actorId: string
    originalStatusId: string
  }) {
    const result = await database('statuses')
      .where('type', StatusType.enum.Announce)
      .where('originalStatusId', originalStatusId)
      .where('actorId', actorId)
      .first<{ id: string }>('id')
    return result?.id ?? null
  }

  async function countStatus({ actorId }: { actorId: string }) {
    return getCounterValue(database, CounterKey.totalStatus(actorId))
  }

  async function updatePollChoice({
    statusId,
    choices
  }: {
    statusId: string
    choices: { title: string }[]
  }) {
    await database('poll_choices').where('statusId', statusId).delete()
    if (choices.length > 0) {
      await database('poll_choices').insert(
        choices.map((choice, index) => ({
          statusId,
          choiceId: index,
          title: choice.title,
          totalVotes: 0
        }))
      )
    }
  }

  async function addPollVote({
    actorId,
    statusId,
    choice
  }: {
    actorId: string
    statusId: string
    choice: number
  }) {
    await database('poll_answers').insert({
      actorId,
      statusId,
      answerId: choice
    })
  }

  async function getPollVotes({
    actorId,
    statusId
  }: {
    actorId: string
    statusId: string
  }) {
    const results = await database('poll_answers')
      .where({ actorId, statusId })
      .select<{ answerId: number }[]>('answerId')
    return results.map((r) => r.answerId)
  }

  async function addStatusTag({
    actorId,
    statusId,
    type,
    name,
    value,
    skipSearchIndex = false
  }: AddStatusTagParams) {
    await database('tags').insert({
      actorId,
      statusId,
      type,
      name,
      value,
      ...(type === 'hashtag'
        ? { nameNormalized: `#${normalizeHashtagSearchName(name)}` }
        : undefined),
      createdAt: new Date(),
      updatedAt: new Date()
    })
    if (type === 'hashtag' && !skipSearchIndex) {
      // Hashtag search stores an aggregate across all public statuses for the
      // tag, so the inserted row alone is not enough to update the document.
      await indexHashtagSearchDocument(database, { hashtag: name })
    }
  }

  return {
    createNote,
    updateNote,
    updateNoteVisibility,
    createAnnounce,
    createPoll,
    updatePoll,
    getStatus,
    getStatusReplies,
    getStatusEditHistory,
    getStatusFromUrl,
    getStatusFromUrlHash,
    getActorAnnouncedStatusId,
    hasActorAnnouncedStatus,
    getActorAnnounceStatus,
    getActorStatusesCount,
    getActorStatuses,
    pinStatus,
    unpinStatus,
    getPinnedStatusIds,
    getStatusesByIds,
    deleteStatus,
    countStatus,
    updatePollChoice,
    addPollVote,
    getPollVotes,
    addStatusTag,
    getFavouritedBy,
    getRebloggedBy,
    createTag,
    getTags,
    deleteStatusTagsByType,
    getStatusesByHashtag,
    getHashtagStatusesPage,
    getHashtagCounter,
    increaseHashtagCounter,
    decreaseHashtagCounter,
    getStatusReblogsCount,
    getStatusReblogsCounts,
    getStatusRepliesCount,
    getStatusRepliesCounts,
    createPollAnswer,
    hasActorVoted,
    getActorPollVotes,
    getActorPollVotesForStatuses,
    incrementPollChoiceVotes,
    recordPollVotes
  }
}
