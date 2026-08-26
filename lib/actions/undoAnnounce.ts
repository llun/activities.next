import { Database } from '@/lib/database/types'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { withSpan } from '@/lib/utils/trace'

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
  withSpan('actions', 'userUndoAnnounce', {}, async (span) => {
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status || status.type !== StatusType.enum.Announce) {
      return null
    }

    if (status.actorId !== currentActor.id) {
      span.setAttribute('unauthorized', true)
      return null
    }

    await database.deleteStatus({ statusId })
    await getQueue().publish({
      // Suffixed to match the activity id the job emits (`<id>#undo`). The
      // boost job publishes under the bare status id and the queue
      // deduplicates on this id ACROSS job names, so without the suffix a
      // boost followed by an unboost inside the dedup window drops the Undo.
      id: getHashFromString(`${status.id}#undo`),
      name: SEND_UNDO_ANNOUNCE_JOB_NAME,
      data: {
        actorId: currentActor.id,
        statusId: status.id,
        // Captured before the delete above, because it is a hard delete: by
        // the time the job runs the Announce row is gone, so everything the
        // Undo activity is built from has to travel in the payload.
        originalStatusId: status.originalStatus.id,
        to: status.to,
        cc: status.cc,
        createdAt: status.createdAt
      }
    })

    return status
  })
