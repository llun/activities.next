import crypto from 'crypto'

import { getStatus, sendAnnounce } from '../activities'
import { AnnounceStatus } from '../activities/actions/announceStatus'
import { Note, getContent, getSummary } from '../activities/entities/note'
import { compact } from '../jsonld'
import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { Storage } from '../storage/types'
import { recordActorIfNeeded } from './utils'

interface AnnounceParams {
  status: AnnounceStatus
  storage: Storage
}
export const announce = async ({ status, storage }: AnnounceParams) => {
  const compactedStatus = (await compact(status)) as AnnounceStatus
  const { object } = compactedStatus

  const existingStatus = await storage.getStatus({
    statusId: object
  })
  if (!existingStatus) {
    const boostedStatus = await getStatus({ statusId: object })
    if (!boostedStatus) return

    const compactedBoostedStatus = (await compact(boostedStatus)) as Note
    const boostedContent = getContent(compactedBoostedStatus)
    const boostedSummary = getSummary(compactedBoostedStatus)

    await Promise.all([
      recordActorIfNeeded({
        actorId: compactedBoostedStatus.attributedTo,
        storage
      }),
      storage.createNote({
        id: compactedBoostedStatus.id,
        url: compactedBoostedStatus.url || compactedBoostedStatus.id,

        actorId: compactedBoostedStatus.attributedTo,

        text: boostedContent,
        summary: boostedSummary,

        to: Array.isArray(boostedStatus.to)
          ? boostedStatus.to
          : [boostedStatus.to].filter((item) => item),
        cc: Array.isArray(boostedStatus.cc)
          ? boostedStatus.cc
          : [boostedStatus.cc].filter((item) => item),

        reply: compactedBoostedStatus.inReplyTo || '',
        createdAt: new Date(compactedBoostedStatus.published).getTime()
      })
    ])
  }

  await Promise.all([
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
  const originalStatus = await storage.getStatus({ statusId })
  if (!originalStatus) return null

  const id = `${currentActor.id}/statuses/${crypto.randomUUID()}`
  const status = await storage.createAnnounce({
    id,
    actorId: currentActor.id,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [currentActor.id, currentActor.followersUrl],
    originalStatusId: originalStatus.id
  })
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
  return status
}
