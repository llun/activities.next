import crypto from 'crypto'

import { sendAnnounce } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'
import { getSpan } from '@/lib/utils/trace'

interface UserAnnounceParams {
  currentActor: Actor
  statusId: string
  storage: Database
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
