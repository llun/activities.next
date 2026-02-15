import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { SQLFitnessFile } from '@/lib/types/database/fitnessFile'
import { ActorDatabase } from '@/lib/types/database/operations'
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
  GetStatusFromUrlHashParams,
  GetStatusFromUrlParams,
  GetStatusParams,
  GetStatusReblogsCountParams,
  GetStatusRepliesCountParams,
  GetStatusRepliesParams,
  GetStatusesByIdsParams,
  GetTagsParams,
  HasActorAnnouncedStatusParams,
  HasActorVotedParams,
  IncrementPollChoiceVotesParams,
  StatusDatabase,
  UpdateNoteParams,
  UpdatePollParams
} from '@/lib/types/database/operations'
import { Actor, getActorProfile } from '@/lib/types/domain/actor'
import { PollChoice } from '@/lib/types/domain/pollChoice'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { getCompatibleJSON } from './utils/getCompatibleJSON'

export const StatusSQLDatabaseMixin = (
  database: Knex,
  actorDatabase: ActorDatabase,
  likeDatabase: LikeDatabase,
  mediaDatabase: MediaDatabase
): StatusDatabase => {
  const parseStatusContent = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: any
  ):
    | string
    | {
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
    return null
  }

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
      actorAnnounceStatusId: null,
      isLocalActor: Boolean(actor?.account),
      createdAt: getCompatibleTime(statusCreatedAt),
      updatedAt: getCompatibleTime(statusUpdatedAt)
    })
  }

  async function updateNote({
    statusId,
    text,
    summary
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
    const status = await database('statuses').where('id', statusId).first()
    if (!status) return null

    return getStatusWithAttachmentsFromData(status, currentActorId, withReplies)
  }

  async function getStatusReplies({ statusId, url }: GetStatusRepliesParams) {
    const statuses = await database('statuses')
      .where((builder) => {
        builder.where('reply', statusId)
        if (url) {
          builder.orWhere('reply', url)
        }
      })
      .orderBy('createdAt', 'desc')
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
      .where('content', statusId)
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
      .where('content', statusId)
      .where('actorId', actorId)
      .first()

    if (!data) return null
    return getStatusWithAttachmentsFromData(data)
  }

  async function getActorStatusesCount({
    actorId
  }: GetActorStatusesCountParams) {
    return getCounterValue(database, CounterKey.totalStatus(actorId))
  }

  async function getActorStatuses({
    actorId,
    minStatusId,
    maxStatusId,
    limit = PER_PAGE_LIMIT
  }: GetActorStatusesParams) {
    let query = database('statuses')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .limit(limit)

    if (minStatusId) {
      const minStatus = await database('statuses')
        .where('id', minStatusId)
        .first()
      if (minStatus) {
        query = query.where('createdAt', '>', minStatus.createdAt)
      }
    }

    if (maxStatusId) {
      const maxStatus = await database('statuses')
        .where('id', maxStatusId)
        .first()
      if (maxStatus) {
        query = query.where('createdAt', '<', maxStatus.createdAt)
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
    withReplies
  }: GetStatusesByIdsParams): Promise<Status[]> {
    if (statusIds.length === 0) {
      return []
    }

    const uniqueStatusIds = [...new Set(statusIds)]
    const statuses = await database('statuses')
      .whereIn('id', uniqueStatusIds)
      .select()
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
            withReplies
          )
        )
      )
    ).filter((status): status is Status => status !== null)

    return statusesWithAttachments
  }

  async function deleteStatus({
    statusId,
    trx
  }: DeleteStatusParams & { trx?: Knex.Transaction }) {
    if (!trx) {
      await database.transaction(async (trx) => {
        await deleteStatus({ statusId, trx })
      })
      return
    }

    const status = await trx('statuses').where('id', statusId).first()
    if (!status) return

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
    await Promise.all([
      trx('statuses').where('id', statusId).delete(),
      trx('recipients').where('statusId', statusId).delete(),
      trx('tags').where('statusId', statusId).delete(),
      trx('attachments').where('statusId', statusId).delete(),
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
    withReplies?: boolean
  ): Promise<Status | null> {
    const [to, cc] = await Promise.all([
      database('recipients').where('statusId', data.id).andWhere('type', 'to'),
      database('recipients').where('statusId', data.id).andWhere('type', 'cc')
    ])

    if (data.type === StatusType.enum.Announce) {
      const originalStatusId = data.content
      const [actor, originalStatus] = await Promise.all([
        actorDatabase.getActorFromId({ id: data.actorId }),
        getStatus({ statusId: originalStatusId, currentActorId })
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
      isActorLikedStatusResult,
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
      currentActorId
        ? likeDatabase.isActorLikedStatus({
            statusId: data.id,
            actorId: currentActorId
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
      isActorLiked: isActorLikedStatusResult,
      actorAnnounceStatusId: actorAnnounceStatus?.id ?? null,
      isLocalActor: Boolean(actor?.account),
      attachments,
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
    statusId
  }: GetStatusRepliesCountParams): Promise<number> {
    return getCounterValue(database, CounterKey.totalReply(statusId))
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
      .where('actorId', actorId)
      .andWhere('originalStatusId', originalStatusId)
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
    createTag,
    getTags,
    getStatusReblogsCount,
    getStatusRepliesCount,
    createPollAnswer,
    hasActorVoted,
    getActorPollVotes,
    incrementPollChoiceVotes
  }
}
