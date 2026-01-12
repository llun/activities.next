import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { ActorDatabase } from '@/lib/database/types/actor'
import { LikeDatabase } from '@/lib/database/types/like'
import { MediaDatabase } from '@/lib/database/types/media'
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
  GetStatusParams,
  GetStatusReblogsCountParams,
  GetStatusRepliesParams,
  GetTagsParams,
  HasActorAnnouncedStatusParams,
  HasActorVotedParams,
  IncrementPollChoiceVotesParams,
  StatusDatabase,
  UpdateNoteParams,
  UpdatePollParams
} from '@/lib/database/types/status'
import { Actor, getActorProfile } from '@/lib/models/actor'
import { PollChoice } from '@/lib/models/pollChoice'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/models/status'
import { Tag } from '@/lib/models/tag'

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
      await updateCount(actorId, currentTime, 'increment', trx)
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
      await updateCount(actorId, currentTime, 'increment', trx)
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
      await updateCount(actorId, currentTime, 'increment', trx)
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
    const result = await database('counters')
      .where('id', `total-status:${actorId}`)
      .first()
    if (!result) return 0
    return result.value
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
    await updateCount(status.actorId, new Date(), 'decrement', trx)
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
      currentActorId
        ? getActorAnnounceStatus({
            statusId: data.id,
            actorId: currentActorId
          })
        : null,
      database('status_history').where('statusId', data.id)
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
      url: content.url,
      to: to.map((item) => item.actorId),
      cc: cc.map((item) => item.actorId),
      actorId: data.actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: data.type,
      text: content.text,
      summary: content.summary,
      reply: data.reply,
      replies: repliesNote,
      totalLikes: parseInt(totalLikes?.count ?? '0', 10),
      isActorLiked: isActorLikedStatusResult,
      actorAnnounceStatusId: actorAnnounceStatus?.id ?? null,
      isLocalActor: Boolean(actor?.account),
      attachments,
      tags,
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

  async function updateCount(
    actorId: string,
    time: Date,
    step: 'increment' | 'decrement',
    trx: Knex.Transaction
  ) {
    const count = await trx('counters')
      .where({
        id: `total-status:${actorId}`
      })
      .first()
    if (!count) {
      await trx('counters').insert({
        id: `total-status:${actorId}`,
        value: 1,
        createdAt: time,
        updatedAt: time
      })
    } else {
      await trx('counters')
        .where({ id: `total-status:${actorId}` })
        .update({
          value: count.value + (step === 'increment' ? 1 : -1),
          updatedAt: time
        })
    }
  }

  async function getStatusReblogsCount({
    statusId
  }: GetStatusReblogsCountParams): Promise<number> {
    const result = await database('statuses')
      .where('type', StatusType.enum.Announce)
      .where('content', statusId)
      .count<{ count: string }>('* as count')
      .first()
    if (!result) return 0
    return parseInt(result.count, 10)
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

  return {
    createNote,
    updateNote,
    createAnnounce,
    createPoll,
    updatePoll,
    getStatus,
    getStatusReplies,
    hasActorAnnouncedStatus,
    getActorAnnounceStatus,
    getActorStatusesCount,
    getActorStatuses,
    deleteStatus,
    getFavouritedBy,
    createTag,
    getTags,
    getStatusReblogsCount,
    createPollAnswer,
    hasActorVoted,
    getActorPollVotes,
    incrementPollChoiceVotes
  }
}
