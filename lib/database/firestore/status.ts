import { FieldValue, Firestore } from '@google-cloud/firestore'
import crypto from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
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
import { PollChoice } from '@/lib/models/pollChoice'
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
import { urlToId } from '@/lib/utils/urlToId'

export interface FirestoreStatusDatabase extends StatusDatabase {
  getStatusFromData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    withReplies: boolean,
    currentActorId?: string,
    isNestedLoad?: boolean
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

    // Get actor and save status in parallel
    const [actor] = await Promise.all([
      actorDatabase.getActorFromId({ id: actorId }),
      firestore.doc(`statuses/${urlToId(id)}`).set(status)
    ])

    // Update actor status count if actor exists
    if (actor) {
      await firestore.doc(`actors/${urlToId(actorId)}`).update({
        statusCount: FieldValue.increment(1),
        lastStatusAt: currentTime
      })
    }

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
      actorAnnounceStatusId: null,
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

    // Save history and update status in parallel
    await Promise.all([
      firestore.doc(historyPath).set(previousData),
      firestore.doc(statusPath).update({
        text,
        ...(summary ? { summary } : null),
        updatedAt: currentTime
      })
    ])

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

    // Get actor and save status in parallel
    const [actor] = await Promise.all([
      actorDatabase.getActorFromId({ id: actorId }),
      firestore.doc(`statuses/${urlToId(id)}`).set(status)
    ])

    // Update actor status count if actor exists
    if (actor) {
      await firestore.doc(`actors/${urlToId(actorId)}`).update({
        statusCount: FieldValue.increment(1),
        lastStatusAt: currentTime
      })
    }

    const originalStatus = await getStatus({
      statusId: originalStatusId,
      withReplies: false
    })
    if (!originalStatus) return null
    if (originalStatus.type !== StatusType.enum.Note) return null

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
    const choicesData = choices.map((choice) =>
      PollChoice.parse({
        statusId: id,
        title: choice,
        totalVotes: 0,
        createdAt: createdAt || currentTime,
        updatedAt: currentTime
      })
    )

    // Get actor and save status in parallel
    const [actor] = await Promise.all([
      actorDatabase.getActorFromId({ id: actorId }),
      firestore.doc(statusPath).set(status)
    ])

    // Update actor status count if actor exists and save choices in parallel
    await Promise.all([
      ...(actor
        ? [
            firestore.doc(`actors/${urlToId(actorId)}`).update({
              statusCount: FieldValue.increment(1),
              lastStatusAt: currentTime
            })
          ]
        : []),
      ...choices.map((title, index) =>
        firestore
          .doc(`${statusPath}/choices/${createMD5(title)}`)
          .set(choicesData[index])
      )
    ])

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
      actorAnnounceStatusId: null,
      isLocalActor: Boolean(actor?.account),
      edits: [],
      attachments: [],
      tags: [],
      replies: [],
      choices: choicesData
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

      // Save history and update status in parallel
      await Promise.all([
        firestore.doc(historyPath).set(previousData),
        firestore.doc(statusPath).update({
          text,
          ...(summary ? { summary } : null),
          updatedAt: currentTime
        })
      ])
    }

    // Update all choices in parallel
    await Promise.all(
      choices.map(async (choice) => {
        const key = `${statusPath}/choices/${createMD5(choice.title)}`
        return firestore.doc(key).update({
          totalVotes: choice.totalVotes,
          updatedAt: currentTime
        })
      })
    )

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
    return getStatusFromData(data, withReplies, currentActorId, false)
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
        const status = await getStatusFromData(data, false, undefined, false)
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

  async function getActorAnnounceStatus({
    actorId,
    statusId
  }: HasActorAnnouncedStatusParams): Promise<Status | null> {
    if (!actorId) return null

    const statuses = firestore.collection('statuses')
    const snapshot = await statuses
      .where('originalStatusId', '==', statusId)
      .where('type', '==', 'Announce')
      .where('actorId', '==', actorId)
      .limit(1)
      .get()

    if (snapshot.empty) return null
    const doc = snapshot.docs[0]
    return getStatusFromData(doc.data(), false, actorId, false)
  }

  async function getActorStatusesCount({
    actorId
  }: GetActorStatusesCountParams) {
    const snapshot = await firestore.doc(`actors/${urlToId(actorId)}`).get()
    const data = snapshot.data()
    return data?.statusCount ?? 0
  }

  async function getActorStatuses({
    actorId,
    minStatusId,
    maxStatusId,
    limit = PER_PAGE_LIMIT
  }: GetActorStatusesParams) {
    const statuses = firestore.collection('statuses')
    let query = statuses
      .where('actorId', '==', actorId)
      .orderBy('createdAt', 'desc')

    if (minStatusId || maxStatusId) {
      if (minStatusId) {
        const minStatus = await firestore
          .doc(`statuses/${urlToId(minStatusId)}`)
          .get()
        if (minStatus.exists) {
          const minStatusData = minStatus.data()
          query = query.where('createdAt', '>', minStatusData?.createdAt)
        }
      }

      if (maxStatusId) {
        const maxStatus = await firestore
          .doc(`statuses/${urlToId(maxStatusId)}`)
          .get()
        if (maxStatus.exists) {
          const maxStatusData = maxStatus.data()
          query = query.where('createdAt', '<', maxStatusData?.createdAt)
        }
      }
    }

    const snapshot = await query.limit(limit).get()
    const items = await Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data()
        return getStatusFromData(data, false, undefined, false)
      })
    )
    return items.filter((item): item is Status => Boolean(item))
  }

  async function deleteStatus({ statusId }: DeleteStatusParams) {
    const status = await getStatus({ statusId })
    if (!status) return

    // Get replies and timeline references in parallel
    const [repliesSnapshot, statusInTimelines] = await Promise.all([
      firestore.collection('statuses').where('reply', '==', statusId).get(),
      firestore
        .collectionGroup('timelines')
        .where('statusId', '==', statusId)
        .get()
    ])

    // Delete all replies in parallel
    await Promise.all(
      repliesSnapshot.docs
        .map((doc) => doc.data().id)
        .map((statusId) => deleteStatus({ statusId }))
    )

    const bulkWriter = firestore.bulkWriter()

    // Delete timeline references and status document in parallel
    await Promise.all([
      ...statusInTimelines.docs.map((doc) => bulkWriter.delete(doc.ref)),
      firestore.recursiveDelete(
        firestore.doc(`statuses/${urlToId(statusId)}`),
        bulkWriter
      )
    ])

    // Update actor status count if local actor
    if (status.isLocalActor) {
      await firestore.doc(`actors/${urlToId(status.actorId)}`).update({
        statusCount: FieldValue.increment(-1)
      })
    }

    await bulkWriter.close()
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
    currentActorId?: string,
    isNestedLoad: boolean = false
  ): Promise<Status | null> {
    if (!data) return null

    if (data.type === StatusType.enum.Announce) {
      if (!data.originalStatusId) {
        logger.error('Announce status original status id is null', data.id)
        return null
      }

      // Get snapshot and actor in parallel
      const [snapshot, actor] = await Promise.all([
        firestore.doc(`statuses/${urlToId(data.originalStatusId)}`).get(),
        actorDatabase.getActorFromId({ id: data.actorId })
      ])

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

      // Load the original status without unnecessary nested operations
      const originalStatus = await getStatusFromData(
        originalStatusData,
        false,
        currentActorId,
        true // Pass true for isNestedLoad
      )

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

    // Prepare all the async operations based on whether this is a nested load
    const attachmentsPromise = mediaDatabase.getAttachments({
      statusId: data.id
    })
    const tagsPromise = getTags({ statusId: data.id })
    const actorPromise = actorDatabase.getActorFromId({ id: data.actorId })
    const totalLikesPromise = likeDatabase.getLikeCount({ statusId: data.id })

    // Only load these items if not a nested load to avoid deep recursion
    const isActorLikedStatusPromise =
      !isNestedLoad && currentActorId
        ? likeDatabase.isActorLikedStatus({
            statusId: data.id,
            actorId: currentActorId
          })
        : Promise.resolve(false)

    const actorAnnounceStatusPromise =
      !isNestedLoad && currentActorId
        ? getActorAnnounceStatus({
            statusId: data.id,
            actorId: currentActorId
          })
        : Promise.resolve(null)

    const pollChoicesPromise =
      data.type === StatusType.enum.Poll
        ? getPollChoices(data.id)
        : Promise.resolve([])

    const editsPromise = !isNestedLoad ? getEdits(data.id) : Promise.resolve([])

    const repliesPromise =
      !isNestedLoad && withReplies
        ? getStatusReplies({ statusId: data.id })
        : Promise.resolve([])

    // Execute all promises in parallel
    const [
      attachments,
      tags,
      actor,
      totalLikes,
      isActorLikedStatus,
      actorAnnounceStatus,
      pollChoices,
      edits,
      replies
    ] = await Promise.all([
      attachmentsPromise,
      tagsPromise,
      actorPromise,
      totalLikesPromise,
      isActorLikedStatusPromise,
      actorAnnounceStatusPromise,
      pollChoicesPromise,
      editsPromise,
      repliesPromise
    ])

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
      actorAnnounceStatusId: actorAnnounceStatus?.id ?? null,
      isLocalActor: Boolean(actor?.account),
      attachments,
      tags,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,

      edits,
      ...(data.type === StatusType.enum.Poll
        ? {
            choices: pollChoices,
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
    return snapshot.docs.map((item) => PollChoice.parse(item.data()))
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
    getActorAnnounceStatus,

    getActorStatusesCount,
    getActorStatuses,

    deleteStatus,

    getFavouritedBy,
    createTag,
    getTags
  }
}
