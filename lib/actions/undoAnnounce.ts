import { Database } from '@/lib/database/types'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { StatusType } from '@/lib/models/status'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getTracer } from '@/lib/utils/trace'

interface UserUndoAnnounceParams {
  currentActor: Actor
  statusId: string
  database: Database
}

export const userUndoAnnounce = async ({
  currentActor,
  database,
  statusId
}: UserUndoAnnounceParams) =>
  getTracer().startActiveSpan('userUndoAnnounce', async (span) => {
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status || status.type !== StatusType.enum.Announce) {
      span.end()
      return null
    }

    if (status.actorId !== currentActor.id) {
      span.setAttribute('unauthorized', true)
      span.end()
      return null
    }

    await database.deleteStatus({ statusId })
    await getQueue().publish({
      id: getHashFromString(status.id),
      name: SEND_UNDO_ANNOUNCE_JOB_NAME,
      data: {
        actorId: currentActor.id,
        statusId: status.id
      }
    })

    span.end()
    return status
  })
