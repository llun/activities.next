import { Database } from '@/lib/database/types'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { JobData } from '@/lib/jobs/sendUndoAnnounceJob'
import { Actor } from '@/lib/models/actor'
import { StatusType } from '@/lib/models/status'
import { getQueue } from '@/lib/services/queue'
import { getTracer } from '@/lib/utils/trace'
import { urlToId } from '@/lib/utils/urlToId'

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

    await database.deleteStatus({ statusId })
    await getQueue().publish({
      id: `undo-announce-${urlToId(status.id)}`,
      name: SEND_UNDO_ANNOUNCE_JOB_NAME,
      data: JobData.parse({
        actorId: currentActor.id,
        statusId: status.id
      })
    })

    span.end()
    return status
  })
