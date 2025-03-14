import crypto from 'crypto'

import { Database } from '@/lib/database/types'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { JobData } from '@/lib/jobs/sendAnnounceJob'
import { Actor } from '@/lib/models/actor'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'
import { getTracer } from '@/lib/utils/trace'
import { urlToId } from '@/lib/utils/urlToId'

interface UserAnnounceParams {
  currentActor: Actor
  statusId: string
  database: Database
}

export const userAnnounce = async ({
  currentActor,
  statusId,
  database
}: UserAnnounceParams) =>
  getTracer().startActiveSpan('userAnnounce', async (span) => {
    const [originalStatus, actorAnnounceStatus] = await Promise.all([
      database.getStatus({
        statusId,
        withReplies: false
      }),
      database.getActorAnnounceStatus({ statusId, actorId: currentActor.id })
    ])

    if (!originalStatus || actorAnnounceStatus) {
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
    await getQueue().publish({
      id: `announce-${urlToId(status.id)}`,
      name: SEND_ANNOUNCE_JOB_NAME,
      data: JobData.parse({
        actorId: currentActor.id,
        statusId: status.id
      })
    })

    span.end()
    return status
  })
