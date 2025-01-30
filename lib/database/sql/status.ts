import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { ActorDatabase } from '@/lib/database/types/actor'
import { LikeDatabase } from '@/lib/database/types/like'
import { MediaDatabase } from '@/lib/database/types/media'
import {
  CreateAnnounceParams,
  CreateNoteParams,
  CreatePollParams,
  CreateTagParams,
  DeleteStatusParams,
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  GetFavouritedByParams,
  GetStatusParams,
  GetStatusRepliesParams,
  GetTagsParams,
  HasActorAnnouncedStatusParams,
  StatusDatabase,
  UpdateNoteParams,
  UpdatePollParams
} from '@/lib/database/types/status'
import { Actor } from '@/lib/models/actor'
import { PollChoice } from '@/lib/models/pollChoice'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/models/status'
import { Tag, TagData } from '@/lib/models/tag'

import { getCompatibleJSON } from './utils/getCompatibleJSON'

export const StatusSQLDatabaseMixin = (
  database: Knex,
  actorDatabase: ActorDatabase,
  likeDatabase: LikeDatabase,
  mediaDatabase: MediaDatabase
): StatusDatabase => {
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
    return new Status({
      id,
      url,
      actorId,
      actor: actor?.toProfile() || null,
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
      isActorAnnounced: false,
      isLocalActor: Boolean(actor?.account),
      createdAt: getCompatibleTime(statusCreatedAt),
      updatedAt: getCompatibleTime(statusUpdatedAt)
    })
  }

  async function updateNote({
    statusId,
    text,
    summary
  }: UpdateNoteParams): Promise<Status | undefined> {
    const status = await getStatus({ statusId })
    if (!status) return

    const data = status.data
    if (data.type !== StatusType.enum.Note) return

    const previousData = {
      text: data.text,
      summary: data.summary
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
        actorId,
        type: StatusType.enum.Announce,
        reply: '',
        content: originalStatusId,
        createdAt: statusCreatedAt,
        updatedAt: statusUpdatedAt
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
    const announceData: StatusAnnounce = {
      id,
      actorId,
      actor: actor?.toProfile() || null,
      to,
      cc,
      edits: [],
      type: StatusType.enum.Announce,
      originalStatus: originalStatus?.data as StatusNote,

      createdAt: getCompatibleTime(statusUpdatedAt),
      updatedAt: getCompatibleTime(statusUpdatedAt)
    }

    return new Status(announceData)
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
    createdAt
  }: CreatePollParams) {
    const currentTime = new Date()
    const statusCreatedAt = createdAt ? new Date(createdAt) : currentTime
    const statusUpdatedAt = currentTime

    await database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        actorId,
        type: StatusType.enum.Poll,
        content: JSON.stringify({
          url,
          text,
          summary,
          endAt
        }),
        reply,
        createdAt: statusCreatedAt,
        updatedAt: statusUpdatedAt
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
    return new Status({
      id,
      url,
      actorId,
      actor: actor?.toProfile() || null,
      type: StatusType.enum.Poll,
      text,
      summary,
      reply,
      to,
      cc,
      edits: [],
      tags: [],
      replies: [],
      choices: [],
      totalLikes: 0,
      isActorLiked: false,
      isActorAnnounced: false,
      endAt,
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
    if (!existingStatus) return
    const currentTime = new Date()

    await database.transaction(async (trx) => {
      if (text !== existingStatus.text || summary !== existingStatus.summary) {
        const data = getCompatibleJSON(existingStatus.content)
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
            content: {
              url: data.url,
              text: data.text,
              summary: data.summary
            },
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
    if (!status) return

    return getStatusWithAttachmentsFromData(status, currentActorId, withReplies)
  }

  async function getStatusReplies({ statusId }: GetStatusRepliesParams) {
    const statuses = await database('statuses')
      .where('reply', statusId)
      .orderBy('createdAt', 'desc')
    return Promise.all(
      statuses.map((status) => getStatusWithAttachmentsFromData(status))
    )
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

  async function getActorStatusesCount({
    actorId
  }: GetActorStatusesCountParams) {
    const result = await database('statuses')
      .where('actorId', actorId)
      .count<{ count: string }>('* as count')
      .first()
    return parseInt(result?.count ?? '0', 10)
  }

  async function getActorStatuses({ actorId }: GetActorStatusesParams) {
    const statuses = await database('statuses')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .limit(PER_PAGE_LIMIT)
    return Promise.all(
      statuses.map((item) => getStatusWithAttachmentsFromData(item))
    )
  }

  async function deleteStatus({ statusId }: DeleteStatusParams) {
    const replies = await database('statuses')
      .where('reply', statusId)
      .select('id')
    await Promise.all(replies.map(({ id }) => deleteStatus({ statusId: id })))

    await database.transaction(async (trx) => {
      await Promise.all([
        trx('statuses').where('id', statusId).delete(),
        trx('recipients').where('statusId', statusId).delete(),
        trx('tags').where('statusId', statusId).delete(),
        trx('attachments').where('statusId', statusId).delete(),
        trx('poll_choices').where('statusId', statusId).delete(),
        trx('timelines').where('statusId', statusId).delete()
      ])
    })
  }

  async function getFavouritedBy({
    statusId
  }: GetFavouritedByParams): Promise<Actor[]> {
    const result = await database('likes').where({ statusId })
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

    const data: TagData = {
      id: crypto.randomUUID(),
      statusId,
      type,
      name,
      value: value || '',
      createdAt: getCompatibleTime(currentTime),
      updatedAt: getCompatibleTime(currentTime)
    }
    await database('tags').insert({
      ...data,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return new Tag(data)
  }

  async function getTags({ statusId }: GetTagsParams) {
    const data = await database<TagData>('tags').where('statusId', statusId)
    return data.map(
      (item) =>
        new Tag({
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
    return raw.map(
      (data) =>
        new PollChoice({
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
  ): Promise<Status> {
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

      const announceData: StatusAnnounce = {
        id: data.id,
        actorId: data.actorId,
        actor: actor?.toProfile() || null,
        type: StatusType.enum.Announce,
        to: to.map((item) => item.actorId),
        cc: cc.map((item) => item.actorId),
        edits: [],
        originalStatus: originalStatus?.data as StatusNote,

        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      }

      return new Status(announceData)
    }

    const [
      attachments,
      tags,
      replies,
      actor,
      totalLikes,
      isActorLikedStatusResult,
      isActorAnnouncedStatus,
      pollChoices,
      edits
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
      database('likes')
        .where('statusId', data.id)
        .count<{ count: string }>('* as count')
        .first(),
      currentActorId
        ? likeDatabase.isActorLikedStatus({
            statusId: data.id,
            actorId: currentActorId
          })
        : false,
      hasActorAnnouncedStatus({
        statusId: data.id,
        actorId: currentActorId
      }),
      getPollChoices(data.id),
      database('status_history').where('statusId', data.id)
    ])

    const repliesNote = (
      await Promise.all(replies.map((item) => getStatus({ statusId: item.id })))
    )
      .map((item) =>
        item?.data.type &&
        [StatusType.enum.Note, StatusType.enum.Poll].includes(
          item?.data.type as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
          ? item.data
          : null
      )
      .filter((item): item is StatusNote => Boolean(item))

    const content = getCompatibleJSON(data.content)
    return new Status({
      id: data.id,
      url: content.url,
      to: to.map((item) => item.actorId),
      cc: cc.map((item) => item.actorId),
      actorId: data.actorId,
      actor: actor?.toProfile() || null,
      type: data.type,
      text: content.text,
      summary: content.summary,
      reply: data.reply,
      replies: repliesNote,
      totalLikes: parseInt(totalLikes?.count ?? '0', 10),
      isActorLiked: isActorLikedStatusResult,
      isActorAnnounced: isActorAnnouncedStatus,
      isLocalActor: Boolean(actor?.account),
      attachments: attachments.map((attachment) => attachment.toJson()),
      tags: tags.map((tag) => tag.toJson()),
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt),

      edits: edits.map((item) => {
        const content = getCompatibleJSON(item.data)
        return {
          text: content.text,
          summary: content.summary ?? null,
          createdAt: getCompatibleTime(item.createdAt)
        }
      }),

      ...(data.type === StatusType.enum.Poll
        ? {
            choices: pollChoices.map((choice) => choice.toJson()),
            endAt: content.endAt
          }
        : null)
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
    hasActorAnnouncedStatus,
    getActorStatusesCount,
    getActorStatuses,
    deleteStatus,
    getFavouritedBy,
    createTag,
    getTags
  }
}
