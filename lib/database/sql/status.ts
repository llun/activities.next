import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { SQLFitnessFile } from '@/lib/types/database/fitnessFile'
import { ActorDatabase } from '@/lib/types/database/operations'
import { BookmarkDatabase } from '@/lib/types/database/operations'
import { LikeDatabase } from '@/lib/types/database/operations'
import { MediaDatabase } from '@/lib/types/database/operations'
import {
  CreateAnnounceParams,
  CreateNoteParams,
  CreatePollAnswerParams,
  CreatePollParams,
  CreateTagParams,
  DeleteStatusParams,
  GetActorPollVotesParams,
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  GetFavouritedByParams,
  GetHashtagStatusesPageParams,
  GetRebloggedByParams,
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
  RecordPollVotesParams,
  StatusDatabase,
  UpdateNoteParams,
  UpdateNoteVisibilityParams,
  UpdatePollParams
} from '@/lib/types/database/operations'
import { Actor, getActorProfile } from '@/lib/types/domain/actor'
import { Attachment, isFitnessAttachment } from '@/lib/types/domain/attachment'
import { FollowStatus } from '@/lib/types/domain/follow'
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
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { getCompatibleJSON } from './utils/getCompatibleJSON'

const PUBLIC_ACTIVITY_RECIPIENTS = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
]
const MAX_ANNOUNCE_RESOLUTION_DEPTH = 10

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
  mediaDatabase: MediaDatabase
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

  const statusActorFollowersUrlExpression = () => {
    const clientName = String(database.client.config.client)
    if (clientName.includes('pg')) {
      return "status_actors.settings::jsonb ->> 'followersUrl'"
    }
    if (clientName.includes('mysql')) {
      return "JSON_UNQUOTE(JSON_EXTRACT(status_actors.settings, '$.followersUrl'))"
    }
    return "json_extract(status_actors.settings, '$.followersUrl')"
  }

  const applyPotentiallyReadableStatusFilter = ({
    query,
    visibleToActorId
  }: {
    query: Knex.QueryBuilder
    visibleToActorId: string
  }) => {
    const clientName = String(database.client.config.client)
    const fallbackFollowersAudienceExpression = clientName.includes('mysql')
      ? "followers_recipients.actorId = CONCAT(statuses.actorId, '/followers')"
      : "followers_recipients.actorId = statuses.actorId || '/followers'"
    const storedFollowersAudienceExpression = `followers_recipients.actorId = ${statusActorFollowersUrlExpression()}`

    return query.where((qb) => {
      qb.whereIn(
        'statuses.id',
        database('recipients')
          .select('statusId')
          .whereIn('recipients.actorId', [
            ...PUBLIC_ACTIVITY_RECIPIENTS,
            visibleToActorId
          ])
      )
        .orWhere('statuses.actorId', visibleToActorId)
        .orWhereExists(function () {
          this.select(database.raw('1'))
            .from('recipients as followers_recipients')
            .leftJoin(
              'actors as status_actors',
              'status_actors.id',
              'statuses.actorId'
            )
            .whereRaw('followers_recipients.statusId = statuses.id')
            .where(function () {
              this.whereRaw(storedFollowersAudienceExpression).orWhereRaw(
                fallbackFollowersAudienceExpression
              )
            })
            .whereExists(function () {
              this.select(database.raw('1'))
                .from('follows')
                .where('follows.actorId', visibleToActorId)
                .whereRaw('follows.targetActorId = statuses.actorId')
                .where('follows.status', FollowStatus.enum.Accepted)
            })
        })
    })
  }

  const parseStatusContent = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: any
  ):
    | string
    | {
        id?: string
        url?: string
      }
    | null => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: any
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
    createdAt
  }: CreateNoteParams) {
    const currentTime = new Date()
    const statusCreatedAt = createdAt ? new Date(createdAt) : currentTime
    const statusUpdatedAt = currentTime

    await database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        url,
        urlHash: getStatusUrlHash(url),
        actorId,
        type: StatusType.enum.Note,
        content: JSON.stringify({
          url,
          text,
          summary
        }),
        reply,
        createdAt: statusCreatedAt,
        updatedAt: statusUpdatedAt
      })
      await updateStatusCounters({
        actorId,
        type: StatusType.enum.Note,
        reply,
        content: {
          url,
          text,
          summary
        },
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

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    return StatusNote.parse({
      id,
      url,
      actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: StatusType.enum.Note,
      text,
      summary,
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
    attachments
  }: UpdateNoteParams): Promise<Status | null> {
    const status = await getStatus({ statusId })
    if (!status) return null

    if (status.type !== StatusType.enum.Note) return null

    const previousData = {
      text: status.text,
      summary: status.summary
    }
    const currentTime = new Date()
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
          content: JSON.stringify({
            url: status.url,
            text,
            summary
          }),
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

    const currentTime = new Date()
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
    })
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
    createdAt
  }: CreatePollParams) {
    const currentTime = new Date()
    const statusCreatedAt = createdAt ? new Date(createdAt) : currentTime
    const statusUpdatedAt = currentTime

    await database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        url,
        urlHash: getStatusUrlHash(url),
        actorId,
        type: StatusType.enum.Poll,
        content: JSON.stringify({
          url,
          text,
          summary,
          endAt,
          pollType
        }),
        reply,
        createdAt: statusCreatedAt,
        updatedAt: statusUpdatedAt
      })
      await updateStatusCounters({
        actorId,
        type: StatusType.enum.Poll,
        reply,
        content: {
          url,
          text,
          summary,
          endAt,
          pollType
        },
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

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    return StatusPoll.parse({
      id,
      url,
      actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: StatusType.enum.Poll,
      text,
      summary,
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
            content: JSON.stringify({
              url: data.url,
              text: nextText,
              summary: nextSummary,
              endAt: data.endAt,
              pollType: data.pollType
            }),
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
    const statusesWithAttachments = (
      await Promise.all(
        statuses.map((item) => getStatusWithAttachmentsFromData(item))
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
    followersAudience
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
    const statusesWithAttachments = (
      await Promise.all(
        statuses.map((item) => getStatusWithAttachmentsFromData(item))
      )
    ).filter((status): status is Status => status !== null)
    return statusesWithAttachments
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
    if (currentActorId) {
      const hydrationStatusIds = await collectHydrationStatusIds(statuses)
      const [bookmarkRows, likeRows] =
        hydrationStatusIds.size > 0
          ? await Promise.all([
              database('bookmarks')
                .where('actorId', currentActorId)
                .whereIn('statusId', [...hydrationStatusIds])
                .select<{ statusId: string }[]>('statusId'),
              database('likes')
                .where('actorId', currentActorId)
                .whereIn('statusId', [...hydrationStatusIds])
                .select<{ statusId: string }[]>('statusId')
            ])
          : [[], []]
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

  async function deleteStatus({
    actorId,
    statusId,
    trx
  }: DeleteStatusParams & { trx?: Knex.Transaction }) {
    if (!trx) {
      await database.transaction(async (trx) => {
        await deleteStatus({ actorId, statusId, trx })
      })
      return
    }

    const status = await trx('statuses').where('id', statusId).first()
    if (!status) return

    if (actorId) {
      const normalizedStoredActorId = normalizeActorId(status.actorId)
      const normalizedExpectedActorId = normalizeActorId(actorId)
      if (
        !normalizedStoredActorId ||
        !normalizedExpectedActorId ||
        normalizedStoredActorId !== normalizedExpectedActorId
      ) {
        return
      }
    }

    const replies = await trx('statuses').where('reply', statusId).select('id')
    await Promise.all(
      replies.map(({ id }) => deleteStatus({ statusId: id, trx }))
    )
    await updateStatusCounters({
      actorId: status.actorId,
      type: status.type,
      reply: status.reply || '',
      content: status.content,
      step: 'decrement',
      trx,
      currentTime: new Date()
    })
    const hashtagTags = await trx('tags')
      .where('statusId', statusId)
      .where('type', 'hashtag')
    if (hashtagTags.length > 0) {
      await Promise.all(
        hashtagTags.map((tag: { name: string }) => {
          const tagName = tag.name.startsWith('#')
            ? tag.name.slice(1)
            : tag.name
          return decreaseCounterValue(
            trx,
            CounterKey.totalHashtag(tagName.toLowerCase())
          )
        })
      )
    }
    await Promise.all([
      trx('statuses').where('id', statusId).delete(),
      trx('recipients').where('statusId', statusId).delete(),
      trx('tags').where('statusId', statusId).delete(),
      trx('attachments').where('statusId', statusId).delete(),
      trx('bookmarks').where('statusId', statusId).delete(),
      trx('poll_choices').where('statusId', statusId).delete(),
      trx('timelines').where('statusId', statusId).delete()
    ])
  }

  async function getFavouritedBy({
    statusId,
    limit,
    offset = 0
  }: GetFavouritedByParams): Promise<Actor[]> {
    let query = database('likes')
      .where({ statusId })
      .orderBy('createdAt', 'desc')
      .orderBy('actorId', 'asc')

    if (typeof limit === 'number') {
      query = query.limit(limit)
    }

    if (offset > 0) {
      query = query.offset(offset)
    }

    const result = await query
    const actors = await Promise.all(
      result.map((item) => actorDatabase.getActorFromId({ id: item.actorId }))
    )
    return actors.filter((actor): actor is Actor => Boolean(actor))
  }

  async function getRebloggedBy({
    statusId,
    limit,
    maxStatusId,
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

    const [maxCursor, sinceCursor] = await Promise.all([
      maxStatusId
        ? visibleReblogsQuery
            .clone()
            .where('statuses.id', maxStatusId)
            .first<{
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
    if (sinceStatusId && !sinceCursor) return []

    let query = dedupedReblogsQuery
      .clone()
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')

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
    return result.map((item) => ({
      actorId: item.actorId,
      statusId: item.id
    }))
  }

  async function createTag({
    statusId,
    name,
    value,
    type
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
        ? { nameNormalized: name.toLowerCase() }
        : undefined),
      createdAt: currentTime,
      updatedAt: currentTime
    })
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

  // Normalise a caller-supplied hashtag value to the form stored in
  // tags.nameNormalized: strip any leading '#' then re-add exactly one.
  function normalizeHashtagName(hashtag: string): string {
    const bare = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag
    return `#${bare.toLowerCase()}`
  }

  async function getStatusesByHashtag({
    hashtag,
    limit = PER_PAGE_LIMIT,
    maxStatusId
  }: GetStatusesByHashtagParams): Promise<Status[]> {
    const normalizedName = normalizeHashtagName(hashtag)
    let query = database('tags')
      .innerJoin('statuses', 'tags.statusId', 'statuses.id')
      .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
      .where('tags.type', 'hashtag')
      .where('tags.nameNormalized', normalizedName)
      .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
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
    const tagName = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag
    return getCounterValue(database, CounterKey.totalHashtag(tagName))
  }

  async function getHashtagStatusesPage({
    hashtag,
    limit,
    offset
  }: GetHashtagStatusesPageParams) {
    const normalizedName = normalizeHashtagName(hashtag)
    const baseQuery = () =>
      database('tags')
        .innerJoin('statuses', 'tags.statusId', 'statuses.id')
        .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
        .where('tags.type', 'hashtag')
        .where('tags.nameNormalized', normalizedName)
        .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
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
    const tagName = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag
    await increaseCounterValue(database, CounterKey.totalHashtag(tagName))
  }

  async function decreaseHashtagCounter({
    hashtag
  }: {
    hashtag: string
  }): Promise<void> {
    const tagName = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag
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
      fitnessFile
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
      database<SQLFitnessFile>('fitness_files')
        .where('statusId', data.id)
        .whereNull('deletedAt')
        .first()
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
      const [pollChoices, voted, ownVotes] = await Promise.all([
        getPollChoices(data.id),
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
        // TODO: Fix this endAt in the data or making sure it's not null
        endAt: content.endAt ?? Date.now(),
        pollType: content.pollType ?? 'oneOf',
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
    value
  }: {
    actorId: string
    statusId: string
    type: string
    name: string
    value: string
  }) {
    await database('tags').insert({
      actorId,
      statusId,
      type,
      name,
      value,
      createdAt: new Date(),
      updatedAt: new Date()
    })
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
    getStatusFromUrl,
    getStatusFromUrlHash,
    getActorAnnouncedStatusId,
    hasActorAnnouncedStatus,
    getActorAnnounceStatus,
    getActorStatusesCount,
    getActorStatuses,
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
    getStatusesByHashtag,
    getHashtagStatusesPage,
    getHashtagCounter,
    increaseHashtagCounter,
    decreaseHashtagCounter,
    getStatusReblogsCount,
    getStatusRepliesCount,
    createPollAnswer,
    hasActorVoted,
    getActorPollVotes,
    incrementPollChoiceVotes,
    recordPollVotes
  }
}
