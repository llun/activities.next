import { FieldValue, Firestore } from '@google-cloud/firestore'
import crypto from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database'
import { urlToId } from '@/lib/database/firestore/urlToId'
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
import { Actor, getActorProfile } from '@/lib/models/actor'
import { PollChoice, PollChoiceData } from '@/lib/models/pollChoice'
import {
  Edited,
  Status,
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/models/status'
import { Tag } from '@/lib/models/tag'
import { logger } from '@/lib/utils/logger'

export interface FirestoreStatusDatabase extends StatusDatabase {
  getStatusFromData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    withReplies: boolean,
    currentActorId?: string
  ): Promise<Status | null>
}

export const StatusFirestoreDatabaseMixin = (
  firestore: Firestore,
  actorDatabase: ActorDatabase,
  likeDatabase: LikeDatabase,
  mediaDatabase: MediaDatabase
): FirestoreStatusDatabase => {
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
    const currentTime = Date.now()
    const status = {
      id,
      url,
      actorId,
      type: StatusType.enum.Note,
      text,
      summary,
      to,
      cc,
      reply,
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    }

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    await Promise.all([
      firestore.doc(`statuses/${urlToId(id)}`).set(status),
      actor
        ? firestore.doc(`actors/${urlToId(actorId)}`).update({
            statusCount: FieldValue.increment(1),
            lastStatusAt: currentTime
          })
        : null
    ])

    const profile = actor ? getActorProfile(actor) : null
    return Status.parse({
      ...status,
      actor: profile
        ? {
            ...profile,
            statusCount: profile?.statusCount + 1,
            lastStatusAt: currentTime
          }
        : null,
      attachments: [],
      totalLikes: 0,
      isActorLiked: false,
      isActorAnnounced: false,
      isLocalActor: Boolean(actor?.account),
      tags: [],
      replies: [],
      edits: []
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

    const currentTime = Date.now()
    const previousData = {
      statusId,
      text: status.text,
      summary: status.summary,
      createdAt: status.createdAt,
      updatedAt: currentTime
    }
    const statusPath = `statuses/${urlToId(statusId)}`
    const historyPath = `${statusPath}/history/${currentTime}`
    await firestore.doc(historyPath).set(previousData)
    await firestore.doc(statusPath).update({
      text,
      ...(summary ? { summary } : null),
      updatedAt: currentTime
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
    const currentTime = Date.now()
    const status = {
      id,
      actorId,
      type: StatusType.enum.Announce,
      to,
      cc,
      originalStatusId,
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    }

    await firestore.doc(`statuses/${urlToId(id)}`).set(status)

    const originalStatus = await getStatus({
      statusId: originalStatusId,
      withReplies: false
    })
    if (!originalStatus) return null
    if (originalStatus.type !== StatusType.enum.Note) return null

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    return StatusAnnounce.parse({
      ...status,
      ...(originalStatus && { originalStatus }),
      edits: [],
      type: StatusType.enum.Announce,
      isLocalActor: Boolean(actor?.account),
      actor: null
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
    choices,
    endAt,
    createdAt
  }: CreatePollParams): Promise<Status> {
    const currentTime = Date.now()
    const status = {
      id,
      url,
      actorId,
      type: StatusType.enum.Poll,
      text,
      summary,
      to,
      cc,
      reply,
      endAt,
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    }
    const statusPath = `statuses/${urlToId(id)}`
    const choicesData: PollChoiceData[] = choices.map((choice) => ({
      statusId: id,
      title: choice,
      totalVotes: 0,
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    }))

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    await Promise.all([
      firestore.doc(statusPath).set(status),
      actor
        ? firestore.doc(`actors/${urlToId(actorId)}`).update({
            statusCount: FieldValue.increment(1),
            lastStatusAt: currentTime
          })
        : null
    ])
    await Promise.all(
      choices.map((title, index) =>
        firestore
          .doc(`${statusPath}/choices/${createMD5(title)}`)
          .set(choicesData[index])
      )
    )

    const profile = actor ? getActorProfile(actor) : null
    return StatusPoll.parse({
      ...status,
      actor: profile
        ? {
            ...profile,
            statusCount: profile?.statusCount + 1,
            lastStatusAt: currentTime
          }
        : null,
      totalLikes: 0,
      isActorLiked: false,
      isActorAnnounced: false,
      isLocalActor: Boolean(actor?.account),
      edits: [],
      attachments: [],
      tags: [],
      replies: [],
      choices: choicesData.map((data) => new PollChoice(data).toJson())
    })
  }

  async function updatePoll({
    statusId,
    text,
    summary,
    choices
  }: UpdatePollParams) {
    const statusPath = `statuses/${urlToId(statusId)}`
    const snapshot = await firestore.doc(statusPath).get()
    if (!snapshot.exists) return null

    const snapshotData = snapshot.data()
    const currentTime = Date.now()
    if (text !== snapshotData?.text || summary !== snapshotData?.summary) {
      const previousData = {
        statusId,
        text: snapshotData?.text,
        ...(snapshotData?.summary ? { summary: snapshotData.summary } : null),
        createdAt: snapshotData?.createdAt,
        updatedAt: currentTime
      }
      const historyPath = `${statusPath}/history/${currentTime}`
      await firestore.doc(historyPath).set(previousData)
      await firestore.doc(statusPath).update({
        text,
        ...(summary ? { summary } : null),
        updatedAt: currentTime
      })
    }
    choices.map(async (choice) => {
      const key = `${statusPath}/choices/${createMD5(choice.title)}`
      return firestore.doc(key).update({
        totalVotes: choice.totalVotes,
        updatedAt: currentTime
      })
    })

    return getStatus({ statusId })
  }

  async function getStatus({
    statusId,
    withReplies = false,
    currentActorId
  }: GetStatusParams) {
    const snapshot = await firestore.doc(`statuses/${urlToId(statusId)}`).get()
    const data = snapshot.data()
    if (!data) return null
    return getStatusFromData(data, withReplies, currentActorId)
  }

  async function getStatusReplies({ statusId }: GetStatusRepliesParams) {
    const statuses = firestore.collection('statuses')
    const snapshot = await statuses
      .where('reply', '==', statusId)
      .orderBy('createdAt', 'desc')
      .get()
    const replies = await Promise.all(
      snapshot.docs.map(async (item) => {
        const data = item.data()
        const status = await getStatusFromData(data, false)
        if (status?.type !== StatusType.enum.Note) return null
        return status
      })
    )
    return replies.filter((item): item is StatusNote => Boolean(item))
  }

  async function hasActorAnnouncedStatus({
    actorId,
    statusId
  }: HasActorAnnouncedStatusParams) {
    if (!actorId) return false

    const statuses = firestore.collection('statuses')
    const snapshot = await statuses
      .where('originalStatusId', '==', statusId)
      .where('type', '==', 'Announce')
      .where('actorId', '==', actorId)
      .count()
      .get()

    return snapshot.data().count === 1
  }

  async function getActorStatusesCount({
    actorId
  }: GetActorStatusesCountParams) {
    const statuses = firestore.collection('statuses')
    const snapshot = await statuses
      .where('actorId', '==', actorId)
      .count()
      .get()
    return snapshot.data().count
  }

  async function getActorStatuses({ actorId }: GetActorStatusesParams) {
    const statuses = firestore.collection('statuses')
    const snapshot = await statuses
      .where('actorId', '==', actorId)
      .orderBy('createdAt', 'desc')
      .limit(PER_PAGE_LIMIT)
      .get()
    const items = await Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data()
        return getStatusFromData(data, false)
      })
    )
    return items.filter((item): item is Status => Boolean(item))
  }

  async function deleteStatus({ statusId }: DeleteStatusParams) {
    const repliesSnapshot = await firestore
      .collection('statuses')
      .where('reply', '==', statusId)
      .get()

    await Promise.all(
      repliesSnapshot.docs
        .map((doc) => doc.data().id)
        .map((statusId) => deleteStatus({ statusId }))
    )

    const statusInTimelines = await firestore
      .collectionGroup('timelines')
      .where('statusId', '==', statusId)
      .get()

    await Promise.all([
      ...statusInTimelines.docs.map((doc) => doc.ref.delete()),
      firestore.doc(`statuses/${urlToId(statusId)}`).delete()
    ])
  }

  async function getFavouritedBy({
    statusId
  }: GetFavouritedByParams): Promise<Actor[]> {
    const favouritedBySnapshot = await firestore
      .collection(`statuses/${urlToId(statusId)}/likes`)
      .get()
    const actors = await Promise.all(
      favouritedBySnapshot.docs.map((doc) =>
        actorDatabase.getActorFromId({ id: doc.data().actorId })
      )
    )
    return actors.filter((item): item is Actor => Boolean(item))
  }

  async function createTag({
    statusId,
    name,
    value,
    type
  }: CreateTagParams): Promise<Tag> {
    const currentTime = Date.now()
    const id = crypto.randomUUID()
    const data = Tag.parse({
      id,
      statusId,
      type,
      name,
      value: value || '',
      createdAt: currentTime,
      updatedAt: currentTime
    })
    await firestore.doc(`statuses/${urlToId(statusId)}/tags/${id}`).set(data)
    return data
  }

  async function getTags({ statusId }: GetTagsParams) {
    const snapshot = await firestore
      .collection(`statuses/${urlToId(statusId)}/tags`)
      .get()
    return snapshot.docs.map((item) => Tag.parse(item.data()))
  }

  async function getStatusFromData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    withReplies: boolean,
    currentActorId?: string
  ): Promise<Status | null> {
    if (!data) return null

    if (data.type === StatusType.enum.Announce) {
      if (!data.originalStatusId) {
        logger.error('Announce status original status id is null', data.id)
        return null
      }

      const snapshot = await firestore
        .doc(`statuses/${urlToId(data.originalStatusId)}`)
        .get()
      const originalStatusData = snapshot.data()
      if (!originalStatusData) return null

      if (originalStatusData.type === StatusType.enum.Announce) {
        logger.error(
          'Announce status announce another status',
          data.id,
          data.originalStatusId
        )
        return null
      }

      const [originalStatus, actor] = await Promise.all([
        getStatusFromData(originalStatusData, withReplies, currentActorId),
        actorDatabase.getActorFromId({
          id: data.actorId
        })
      ])
      if (!originalStatus) return null
      return StatusAnnounce.parse({
        id: data.id,
        actorId: data.actorId,
        actor: actor ? getActorProfile(actor) : null,
        type: data.type,

        to: data.to,
        cc: data.cc,
        edits: [],

        originalStatus,
        isLocalActor: Boolean(actor?.account),

        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      })
    }

    const [
      attachments,
      tags,
      actor,
      totalLikes,
      isActorLikedStatus,
      isActorAnnouncedStatus,
      pollChoices,
      edits
    ] = await Promise.all([
      mediaDatabase.getAttachments({ statusId: data.id }),
      getTags({ statusId: data.id }),
      actorDatabase.getActorFromId({ id: data.actorId }),
      likeDatabase.getLikeCount({ statusId: data.id }),
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
      getEdits(data.id)
    ])

    const replies = withReplies
      ? await getStatusReplies({ statusId: data.id })
      : []
    return Status.parse({
      id: data.id,
      url: data.url,
      to: data.to,
      cc: data.cc,
      actorId: data.actorId,
      actor: actor ? getActorProfile(actor) : null,
      type: data.type,
      text: data.text,
      summary: data.summary,
      reply: data.reply,
      replies,
      totalLikes,
      isActorLiked: isActorLikedStatus,
      isActorAnnounced: isActorAnnouncedStatus,
      isLocalActor: Boolean(actor?.account),
      attachments: attachments.map((attachment) => attachment.toJson()),
      tags,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,

      edits,
      ...(data.type === StatusType.enum.Poll
        ? {
            choices: pollChoices.map((choice) => choice.toJson()),
            endAt: data.endAt
          }
        : null)
    })
  }

  // Private
  function createMD5(content: string) {
    const hash = crypto.createHash('md5')
    hash.update(content)
    return hash.digest('hex')
  }

  async function getPollChoices(statusId: string) {
    const snapshot = await firestore
      .collection(`statuses/${urlToId(statusId)}/choices`)
      .get()
    return snapshot.docs.map(
      (item) => new PollChoice(item.data() as PollChoiceData)
    )
  }

  async function getEdits(statusId: string) {
    const snapshot = await firestore
      .collection(`statuses/${urlToId(statusId)}/history`)
      .get()
    return snapshot.docs.map((item) => item.data() as Edited)
  }

  return {
    createNote,
    updateNote,

    createAnnounce,
    createPoll,
    updatePoll,

    getStatus,
    getStatusReplies,
    getStatusFromData,

    hasActorAnnouncedStatus,

    getActorStatusesCount,
    getActorStatuses,

    deleteStatus,

    getFavouritedBy,
    createTag,
    getTags
  }
}
