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
  database: Database
}
export const userAnnounce = async ({
  currentActor,
  statusId,
  database
}: UserAnnounceParams) => {
  const span = getSpan('actions', 'userAnnounce')
  const [originalStatus, hasActorAnnouncedStatus] = await Promise.all([
    database.getStatus({
      statusId,
      withReplies: false
    }),
    database.hasActorAnnouncedStatus({ statusId, actorId: currentActor.id })
  ])
  if (!originalStatus || hasActorAnnouncedStatus) {
    span.end()
    return null
  }

  const id = `${currentActor.id}/statuses/${crypto.randomUUID()}`
  const status = await database.createAnnounce({
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
  await addStatusToTimelines(database, status)
  const inboxes = await database.getFollowersInbox({
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
