import { Firestore } from '@google-cloud/firestore'

import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/firestore/utils/counter'
import { getCompatibleTime } from '@/lib/database/firestore/utils'
import {
  ActorDatabase,
  LikeDatabase,
  MediaDatabase,
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

export const StatusFirestoreDatabaseMixin = (
  database: Firestore,
  actorDatabase: ActorDatabase,
  likeDatabase: LikeDatabase,
  mediaDatabase: MediaDatabase
): StatusDatabase => {
  const getStatusUrlHash = (url: string): string => getHashFromString(url)

  const resolveParentStatusIdByReply = async (
    reply: string
  ): Promise<string | null> => {
    if (!reply) return null

    const doc = await database.collection('statuses').doc(encodeURIComponent(reply)).get()
    if (doc.exists) return reply

    const byUrl = await database
      .collection('statuses')
      .where('urlHash', '==', getStatusUrlHash(reply))
      .where('url', '==', reply)
      .limit(1)
      .get()
    if (!byUrl.empty) return byUrl.docs[0].id

    return null
  }

  const updateStatusCounters = async (
    params: {
      actorId: string
      type: StatusType
      reply: string
      content: any
      step: 'increment' | 'decrement'
    }
  ) => {
    const adjust = params.step === 'increment' ? increaseCounterValue : decreaseCounterValue

    await adjust(database, CounterKey.totalStatus(params.actorId), 1)

    if (params.type === StatusType.enum.Announce) {
      const originalStatusId = params.content
      if (originalStatusId) {
        await adjust(database, CounterKey.totalReblog(originalStatusId), 1)
      }
    }

    if (params.reply) {
      const parentStatusId = await resolveParentStatusIdByReply(params.reply)
      if (parentStatusId) {
        await adjust(database, CounterKey.totalReply(parentStatusId), 1)
      }
    }
  }

  async function createNote(params: CreateNoteParams) {
    const currentTime = new Date()
    const statusCreatedAt = params.createdAt ? new Date(params.createdAt) : currentTime
    const statusUpdatedAt = currentTime

    const statusData = {
      id: params.id,
      url: params.url,
      urlHash: getStatusUrlHash(params.url),
      actorId: params.actorId,
      type: StatusType.enum.Note,
      content: JSON.stringify({
        url: params.url,
        text: params.text,
        summary: params.summary
      }),
      reply: params.reply || '',
      createdAt: statusCreatedAt,
      updatedAt: statusUpdatedAt
    }

    await database.runTransaction(async (trx) => {
      trx.set(database.collection('statuses').doc(encodeURIComponent(params.id)), statusData)
      
      for (const actorId of params.to) {
        const id = crypto.randomUUID()
        trx.set(database.collection('recipients').doc(id), {
          id,
          statusId: params.id,
          actorId,
          type: 'to',
          createdAt: statusUpdatedAt,
          updatedAt: statusUpdatedAt
        })
      }

      for (const actorId of params.cc) {
        const id = crypto.randomUUID()
        trx.set(database.collection('recipients').doc(id), {
          id,
          statusId: params.id,
          actorId,
          type: 'cc',
          createdAt: statusUpdatedAt,
          updatedAt: statusUpdatedAt
        })
      }
    })

    await updateStatusCounters({
      actorId: params.actorId,
      type: StatusType.enum.Note,
      reply: params.reply || '',
      content: {
        url: params.url,
        text: params.text,
        summary: params.summary
      },
      step: 'increment'
    })

    const actor = await actorDatabase.getActorFromId({ id: params.actorId })
    return StatusNote.parse({
      id: params.id,
      url: params.url,
      actorId: params.actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: StatusType.enum.Note,
      text: params.text,
      summary: params.summary ?? '',
      reply: params.reply || '',
      to: params.to,
      cc: params.cc,
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

  async function updateNote(params: UpdateNoteParams): Promise<Status | null> {
    const status = await getStatus({ statusId: params.statusId })
    if (!status || status.type !== StatusType.enum.Note) return null

    const previousData = {
      text: status.text,
      summary: status.summary
    }
    const currentTime = new Date()
    
    await database.runTransaction(async (trx) => {
      const historyId = crypto.randomUUID()
      trx.set(database.collection('status_history').doc(historyId), {
        id: historyId,
        statusId: status.id,
        data: JSON.stringify(previousData),
        createdAt: new Date(status.createdAt),
        updatedAt: currentTime
      })
      trx.update(database.collection('statuses').doc(encodeURIComponent(status.id)), {
        content: JSON.stringify({
          url: status.url,
          text: params.text,
          summary: params.summary
        }),
        updatedAt: currentTime
      })
    })

    return getStatus({ statusId: params.statusId })
  }

  async function createAnnounce(params: CreateAnnounceParams) {
    const currentTime = new Date()
    const statusCreatedAt = params.createdAt ? new Date(params.createdAt) : currentTime
    const statusUpdatedAt = currentTime

    const statusData = {
      id: params.id,
      url: null,
      urlHash: null,
      actorId: params.actorId,
      type: StatusType.enum.Announce,
      reply: '',
      content: params.originalStatusId,
      createdAt: statusCreatedAt,
      updatedAt: statusUpdatedAt
    }

    await database.runTransaction(async (trx) => {
      trx.set(database.collection('statuses').doc(encodeURIComponent(params.id)), statusData)
      
      for (const actorId of params.to) {
        const id = crypto.randomUUID()
        trx.set(database.collection('recipients').doc(id), {
          id,
          statusId: params.id,
          actorId,
          type: 'to',
          createdAt: statusUpdatedAt,
          updatedAt: statusUpdatedAt
        })
      }

      for (const actorId of params.cc) {
        const id = crypto.randomUUID()
        trx.set(database.collection('recipients').doc(id), {
          id,
          statusId: params.id,
          actorId,
          type: 'cc',
          createdAt: statusUpdatedAt,
          updatedAt: statusUpdatedAt
        })
      }
    })

    await updateStatusCounters({
      actorId: params.actorId,
      type: StatusType.enum.Announce,
      reply: '',
      content: params.originalStatusId,
      step: 'increment'
    })

    const [originalStatus, actor] = await Promise.all([
      getStatus({ statusId: params.originalStatusId }),
      actorDatabase.getActorFromId({ id: params.actorId })
    ])
    return StatusAnnounce.parse({
      id: params.id,
      actorId: params.actorId,
      actor: actor ? getActorProfile(actor) : null,
      to: params.to,
      cc: params.cc,
      edits: [],
      type: StatusType.enum.Announce,
      originalStatus: originalStatus as StatusNote,
      isLocalActor: Boolean(actor?.account),
      createdAt: getCompatibleTime(statusUpdatedAt),
      updatedAt: getCompatibleTime(statusUpdatedAt)
    })
  }

  async function createPoll(params: CreatePollParams) {
    const currentTime = new Date()
    const statusCreatedAt = params.createdAt ? new Date(params.createdAt) : currentTime
    const statusUpdatedAt = currentTime

    const statusData = {
      id: params.id,
      url: params.url,
      urlHash: getStatusUrlHash(params.url),
      actorId: params.actorId,
      type: StatusType.enum.Poll,
      content: JSON.stringify({
        url: params.url,
        text: params.text,
        summary: params.summary,
        endAt: params.endAt,
        pollType: params.pollType
      }),
      reply: params.reply || '',
      createdAt: statusCreatedAt,
      updatedAt: statusUpdatedAt
    }

    await database.runTransaction(async (trx) => {
      trx.set(database.collection('statuses').doc(encodeURIComponent(params.id)), statusData)
      
      params.choices.forEach((choice, index) => {
        const choiceId = `${params.id}:${index}`
        trx.set(database.collection('poll_choices').doc(encodeURIComponent(choiceId)), {
          statusId: params.id,
          choiceId: index,
          title: choice,
          totalVotes: 0,
          createdAt: statusUpdatedAt,
          updatedAt: statusUpdatedAt
        })
      })

      for (const actorId of params.to) {
        const id = crypto.randomUUID()
        trx.set(database.collection('recipients').doc(id), {
          id,
          statusId: params.id,
          actorId,
          type: 'to',
          createdAt: statusUpdatedAt,
          updatedAt: statusUpdatedAt
        })
      }

      for (const actorId of params.cc) {
        const id = crypto.randomUUID()
        trx.set(database.collection('recipients').doc(id), {
          id,
          statusId: params.id,
          actorId,
          type: 'cc',
          createdAt: statusUpdatedAt,
          updatedAt: statusUpdatedAt
        })
      }
    })

    await updateStatusCounters({
      actorId: params.actorId,
      type: StatusType.enum.Poll,
      reply: params.reply || '',
      content: {
        url: params.url,
        text: params.text,
        summary: params.summary,
        endAt: params.endAt,
        pollType: params.pollType
      },
      step: 'increment'
    })

    const actor = await actorDatabase.getActorFromId({ id: params.actorId })
    return StatusPoll.parse({
      id: params.id,
      url: params.url,
      actorId: params.actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: StatusType.enum.Poll,
      text: params.text,
      summary: params.summary ?? '',
      reply: params.reply || '',
      to: params.to,
      cc: params.cc,
      edits: [],
      attachments: [],
      tags: [],
      replies: [],
      choices: [],
      totalLikes: 0,
      isActorLiked: false,
      actorAnnounceStatusId: null,
      endAt: params.endAt,
      pollType: params.pollType,
      isLocalActor: Boolean(actor?.account),
      createdAt: getCompatibleTime(statusCreatedAt),
      updatedAt: getCompatibleTime(statusUpdatedAt)
    })
  }

  async function updatePoll(params: UpdatePollParams) {
    const docRef = database.collection('statuses').doc(encodeURIComponent(params.statusId))
    const doc = await docRef.get()
    if (!doc.exists) return null

    const data = JSON.parse(doc.data()?.content)
    const currentTime = new Date()

    await database.runTransaction(async (trx) => {
      trx.update(docRef, {
        content: JSON.stringify({
          ...data,
          text: params.text ?? data.text,
          summary: params.summary ?? data.summary
        }),
        updatedAt: currentTime
      })

      for (const choice of params.choices) {
        const choicesResult = await database.collection('poll_choices')
          .where('statusId', '==', params.statusId)
          .where('title', '==', choice.title)
          .limit(1)
          .get()
        if (!choicesResult.empty) {
          trx.update(choicesResult.docs[0].ref, {
            totalVotes: choice.totalVotes,
            updatedAt: currentTime
          })
        }
      }
    })

    return getStatus({ statusId: params.statusId })
  }

  async function getStatus(params: GetStatusParams) {
    const doc = await database.collection('statuses').doc(encodeURIComponent(params.statusId)).get()
    if (!doc.exists) return null

    return getStatusWithAttachmentsFromData(doc.data(), params.currentActorId, params.withReplies)
  }

  async function getStatusWithAttachmentsFromData(
    data: any,
    currentActorId?: string,
    withReplies?: boolean
  ): Promise<Status | null> {
    const [toResult, ccResult] = await Promise.all([
      database.collection('recipients').where('statusId', '==', data.id).where('type', '==', 'to').get(),
      database.collection('recipients').where('statusId', '==', data.id).where('type', '==', 'cc').get()
    ])

    const to = toResult.docs.map(doc => doc.data().actorId)
    const cc = ccResult.docs.map(doc => doc.data().actorId)

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
        to,
        cc,
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
      repliesResult,
      actor,
      totalLikes,
      isActorLiked,
      actorAnnounceStatus,
      editsResult
    ] = await Promise.all([
      mediaDatabase.getAttachments({ statusId: data.id }),
      getTags({ statusId: data.id }),
      withReplies
        ? database.collection('statuses').where('reply', '==', data.id).orderBy('createdAt', 'desc').get()
        : Promise.resolve({ docs: [] }),
      actorDatabase.getActorFromId({ id: data.actorId }),
      getCounterValue(database, CounterKey.totalLike(data.id)),
      currentActorId ? likeDatabase.isActorLikedStatus({ statusId: data.id, actorId: currentActorId }) : Promise.resolve(false),
      currentActorId ? getActorAnnounceStatus({ statusId: data.id, actorId: currentActorId }) : Promise.resolve(null),
      database.collection('status_history').where('statusId', '==', data.id).get()
    ])

    const replies = (await Promise.all(
      repliesResult.docs.map(doc => getStatus({ statusId: doc.id }))
    )).filter((s): s is StatusNote => s !== null && (s.type === StatusType.enum.Note || s.type === StatusType.enum.Poll))

    const content = JSON.parse(data.content)
    const base = {
      id: data.id,
      url: content.url ?? data.url,
      to,
      cc,
      actorId: data.actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: data.type,
      text: content.text,
      summary: content.summary,
      reply: data.reply,
      replies,
      totalLikes,
      isActorLiked,
      actorAnnounceStatusId: actorAnnounceStatus?.id ?? null,
      isLocalActor: Boolean(actor?.account),
      attachments,
      tags,
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt),
      edits: editsResult.docs.map(doc => {
        const d = JSON.parse(doc.data().data)
        return {
          text: d.text,
          summary: d.summary ?? null,
          createdAt: getCompatibleTime(doc.data().createdAt)
        }
      })
    }

    if (data.type === StatusType.enum.Poll) {
      const [choices, voted, ownVotes] = await Promise.all([
        getPollChoices(data.id),
        currentActorId ? hasActorVoted({ statusId: data.id, actorId: currentActorId }) : Promise.resolve(false),
        currentActorId ? getActorPollVotes({ statusId: data.id, actorId: currentActorId }) : Promise.resolve([])
      ])
      return StatusPoll.parse({
        ...base,
        choices,
        endAt: content.endAt ?? Date.now(),
        pollType: content.pollType ?? 'oneOf',
        voted,
        ownVotes
      })
    }

    return StatusNote.parse(base)
  }

  async function getStatusReplies(params: GetStatusRepliesParams) {
    const result = await database.collection('statuses')
      .where('reply', '==', params.statusId)
      .orderBy('createdAt', 'desc')
      .get()
    const statuses = (await Promise.all(
      result.docs.map(doc => getStatusWithAttachmentsFromData(doc.data()))
    )).filter((s): s is Status => s !== null)
    return statuses
  }

  async function hasActorAnnouncedStatus(params: HasActorAnnouncedStatusParams) {
    if (!params.actorId) return false
    const result = await database.collection('statuses')
      .where('type', '==', StatusType.enum.Announce)
      .where('content', '==', params.statusId)
      .where('actorId', '==', params.actorId)
      .limit(1)
      .get()
    return !result.empty
  }

  async function getActorAnnounceStatus(params: HasActorAnnouncedStatusParams) {
    if (!params.actorId) return null
    const result = await database.collection('statuses')
      .where('type', '==', StatusType.enum.Announce)
      .where('content', '==', params.statusId)
      .where('actorId', '==', params.actorId)
      .limit(1)
      .get()
    if (result.empty) return null
    return getStatusWithAttachmentsFromData(result.docs[0].data())
  }

  async function getActorStatusesCount(params: GetActorStatusesCountParams) {
    return getCounterValue(database, CounterKey.totalStatus(params.actorId))
  }

  async function getActorStatuses(params: GetActorStatusesParams) {
    let query = database.collection('statuses')
      .where('actorId', '==', params.actorId)
      .orderBy('createdAt', 'desc')
      .limit(params.limit ?? 20)

    if (params.minStatusId) {
      const minDoc = await database.collection('statuses').doc(encodeURIComponent(params.minStatusId)).get()
      if (minDoc.exists) {
        query = query.startAfter(minDoc)
      }
    }
    if (params.maxStatusId) {
      const maxDoc = await database.collection('statuses').doc(encodeURIComponent(params.maxStatusId)).get()
      if (maxDoc.exists) {
        query = query.endBefore(maxDoc)
      }
    }

    const result = await query.get()
    return (await Promise.all(
      result.docs.map(doc => getStatusWithAttachmentsFromData(doc.data()))
    )).filter((s): s is Status => s !== null)
  }

  async function getStatusesByIds(params: GetStatusesByIdsParams) {
    if (params.statusIds.length === 0) return []
    const result = await database.collection('statuses')
      .where('id', 'in', params.statusIds)
      .get()
    const statusMap = new Map(result.docs.map(doc => [doc.data().id, doc.data()]))
    return (await Promise.all(
      params.statusIds.map(id => {
        const data = statusMap.get(id)
        return data ? getStatusWithAttachmentsFromData(data, params.currentActorId, params.withReplies) : null
      })
    )).filter((s): s is Status => s !== null)
  }

  async function deleteStatus(params: DeleteStatusParams) {
    const docRef = database.collection('statuses').doc(encodeURIComponent(params.statusId))
    const doc = await docRef.get()
    if (!doc.exists) return

    const data = doc.data() as any
    const replies = await database.collection('statuses').where('reply', '==', params.statusId).get()
    await Promise.all(replies.docs.map(doc => deleteStatus({ statusId: doc.id })))

    await updateStatusCounters({
      actorId: data.actorId,
      type: data.type,
      reply: data.reply || '',
      content: data.content,
      step: 'decrement'
    })

    const batch = database.batch()
    batch.delete(docRef)
    
    const recipients = await database.collection('recipients').where('statusId', '==', params.statusId).get()
    recipients.docs.forEach(doc => batch.delete(doc.ref))

    const tags = await database.collection('tags').where('statusId', '==', params.statusId).get()
    tags.docs.forEach(doc => batch.delete(doc.ref))

    const pollChoices = await database.collection('poll_choices').where('statusId', '==', params.statusId).get()
    pollChoices.docs.forEach(doc => batch.delete(doc.ref))

    const timelines = await database.collection('timelines').where('statusId', '==', params.statusId).get()
    timelines.docs.forEach(doc => batch.delete(doc.ref))

    await batch.commit()
  }

  async function getFavouritedBy(params: GetFavouritedByParams) {
    let query = database.collection('likes')
      .where('statusId', '==', params.statusId)
      .orderBy('createdAt', 'desc')
    
    if (params.limit) query = query.limit(params.limit)
    if (params.offset) query = query.offset(params.offset)

    const result = await query.get()
    const actors = await Promise.all(
      result.docs.map(doc => actorDatabase.getActorFromId({ id: doc.data().actorId }))
    )
    return actors.filter((a): a is Actor => a !== null)
  }

  async function createTag(params: CreateTagParams) {
    const id = crypto.randomUUID()
    const currentTime = new Date()
    const data = {
      ...params,
      id,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database.collection('tags').doc(id).set(data)
    return Tag.parse({
      ...data,
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  }

  async function getTags(params: GetTagsParams) {
    const result = await database.collection('tags').where('statusId', '==', params.statusId).get()
    return result.docs.map(doc => {
      const data = doc.data() as any
      return Tag.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  }

  async function getPollChoices(statusId: string) {
    const result = await database.collection('poll_choices')
      .where('statusId', '==', statusId)
      .orderBy('choiceId', 'asc')
      .get()
    return result.docs.map(doc => {
      const data = doc.data() as any
      return PollChoice.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  }

  async function getStatusReblogsCount(params: GetStatusReblogsCountParams) {
    return getCounterValue(database, CounterKey.totalReblog(params.statusId))
  }

  async function getStatusRepliesCount(params: GetStatusRepliesCountParams) {
    return getCounterValue(database, CounterKey.totalReply(params.statusId))
  }

  async function createPollAnswer(params: CreatePollAnswerParams) {
    const id = `${params.statusId}:${params.actorId}:${params.choice}`
    await database.collection('poll_answers').doc(encodeURIComponent(id)).set({
      ...params,
      createdAt: new Date(),
      updatedAt: new Date()
    })
  }

  async function hasActorVoted(params: HasActorVotedParams) {
    const result = await database.collection('poll_answers')
      .where('statusId', '==', params.statusId)
      .where('actorId', '==', params.actorId)
      .limit(1)
      .get()
    return !result.empty
  }

  async function getActorPollVotes(params: GetActorPollVotesParams) {
    const result = await database.collection('poll_answers')
      .where('statusId', '==', params.statusId)
      .where('actorId', '==', params.actorId)
      .get()
    return result.docs.map(doc => doc.data().choice)
  }

  async function incrementPollChoiceVotes(params: IncrementPollChoiceVotesParams) {
    const result = await database.collection('poll_choices')
      .where('statusId', '==', params.statusId)
      .where('choiceId', '==', params.choiceIndex)
      .limit(1)
      .get()
    if (result.empty) return
    await result.docs[0].ref.update({
      totalVotes: FieldValue.increment(1),
      updatedAt: new Date()
    })
  }

  async function getStatusFromUrl(params: { url: string }) {
    const result = await database.collection('statuses')
      .where('urlHash', '==', getStatusUrlHash(params.url))
      .where('url', '==', params.url)
      .limit(1)
      .get()
    if (result.empty) return null
    return getStatus({ statusId: result.docs[0].id })
  }

  async function getActorAnnouncedStatusId(params: { actorId: string, originalStatusId: string }) {
    const result = await database.collection('statuses')
      .where('actorId', '==', params.actorId)
      .where('type', '==', StatusType.enum.Announce)
      .where('content', '==', params.originalStatusId)
      .limit(1)
      .get()
    return result.empty ? null : result.docs[0].id
  }

  async function countStatus(params: { actorId: string }) {
    return getCounterValue(database, CounterKey.totalStatus(params.actorId))
  }

  async function updatePollChoice(params: { statusId: string, choices: { title: string }[] }) {
    const result = await database.collection('poll_choices').where('statusId', '==', params.statusId).get()
    const batch = database.batch()
    result.docs.forEach(doc => batch.delete(doc.ref))
    
    params.choices.forEach((choice, index) => {
      const choiceId = `${params.statusId}:${index}`
      batch.set(database.collection('poll_choices').doc(encodeURIComponent(choiceId)), {
        statusId: params.statusId,
        choiceId: index,
        title: choice.title,
        totalVotes: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      })
    })
    await batch.commit()
  }

  async function addPollVote(params: { actorId: string, statusId: string, choice: number }) {
    await createPollAnswer(params)
  }

  async function getPollVotes(params: { actorId: string, statusId: string }) {
    return getActorPollVotes(params)
  }

  async function addStatusTag(params: { actorId: string, statusId: string, type: string, name: string, value: string }) {
    await createTag({ statusId: params.statusId, name: params.name, value: params.value, type: params.type as any })
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

import { FieldValue } from '@google-cloud/firestore'
