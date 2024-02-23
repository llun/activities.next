import crypto from 'crypto'

import { addStatusToTimelines } from '@/lib/services/timelines'
import { compact } from '@/lib/utils/jsonld'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'

import { getStatus, sendAnnounce } from '../activities'
import { AnnounceStatus } from '../activities/actions/announceStatus'
import { Actor } from '../models/actor'
import { Storage } from '../storage/types'
import { getSpan } from '../utils/trace'
import { createNote } from './createNote'
import { recordActorIfNeeded } from './utils'

interface AnnounceParams {
  status: AnnounceStatus
  storage: Storage
}
export const announce = async ({ status, storage }: AnnounceParams) => {
  const span = getSpan('actions', 'announce')
  const compactedStatus = (await compact(status)) as AnnounceStatus
  const { object } = compactedStatus

  const existingStatus = await storage.getStatus({
    statusId: object,
    withReplies: false
  })
  if (!existingStatus) {
    const boostedStatus = await getStatus({ statusId: object })
    if (!boostedStatus) {
      span.end()
      return
    }

    await createNote({ note: boostedStatus, storage })
  }

  const existingAnnounce = await storage.getStatus({
    statusId: compactedStatus.id,
    withReplies: false
  })
  if (existingAnnounce) {
    span.end()
    return
  }
  const [, announce] = await Promise.all([
    recordActorIfNeeded({ actorId: compactedStatus.actor, storage }),
    storage.createAnnounce({
      id: compactedStatus.id,
      actorId: compactedStatus.actor,
      to: Array.isArray(status.to)
        ? status.to
        : [status.to].filter((item) => item),
      cc: Array.isArray(status.cc)
        ? status.cc
        : [status.cc].filter((item) => item),
      originalStatusId: object
    })
  ])
  if (!announce) {
    span.end()
    return
  }
  await addStatusToTimelines(storage, announce)
  span.end()
}

interface UserAnnounceParams {
  currentActor: Actor
  statusId: string
  storage: Storage
}
export const userAnnounce = async ({
  currentActor,
  statusId,
  storage
}: UserAnnounceParams) => {
  const span = getSpan('actions', 'userAnnounce')
  const [originalStatus, hasActorAnnouncedStatus] = await Promise.all([
    storage.getStatus({
      statusId,
      withReplies: false
    }),
    storage.hasActorAnnouncedStatus({ statusId, actorId: currentActor.id })
  ])
  if (!originalStatus || hasActorAnnouncedStatus) {
    span.end()
    return null
  }

  const id = `${currentActor.id}/statuses/${crypto.randomUUID()}`
  const status = await storage.createAnnounce({
    id,
    actorId: currentActor.id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [currentActor.id, currentActor.followersUrl],
    originalStatusId: originalStatus.id
  })
  if (!status) {
    span.end()
    return null
  }
  await addStatusToTimelines(storage, status)
  const inboxes = await storage.getFollowersInbox({
    targetActorId: currentActor.id
  })
  await Promise.all(
    inboxes.map((inbox) => {
      return sendAnnounce({
        currentActor,
        inbox,
        status
      })
    })
  )
  span.end()
  return status
}
