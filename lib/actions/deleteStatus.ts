import { Database } from '@/lib/database/types'
import { SEND_DELETE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

interface DeleteStatusFromUserInputParams {
  currentActor: Actor
  statusId: string
  database: Database
}
export const deleteStatusFromUserInput = async ({
  currentActor,
  statusId,
  database
}: DeleteStatusFromUserInputParams): Promise<void> =>
  withSpan('actions', 'deleteNote', { statusId }, async () => {
    const originalStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    if (!originalStatus) {
      return
    }
    const normalizedCurrentActorId = normalizeActorId(currentActor.id)
    const normalizedStatusActorId = normalizeActorId(originalStatus.actorId)
    if (
      !normalizedCurrentActorId ||
      !normalizedStatusActorId ||
      normalizedCurrentActorId !== normalizedStatusActorId
    ) {
      return
    }

    // Delete locally first so the status leaves the author's timelines
    // immediately, then federate the Tombstone in the background. Delivery used
    // to run inline ahead of this, which made the request wait on every remote
    // inbox (and left the status undeleted whenever one of them failed).
    await database.deleteStatus({ statusId, actorId: currentActor.id })

    try {
      await getQueue().publish({
        // Suffixed because the queue deduplicates on this id across job names
        // and the create/update jobs already publish under the bare status id.
        // Without it, deleting a status posted or edited within the dedup
        // window would be dropped and never federate.
        id: getHashFromString(`${statusId}#delete`),
        name: SEND_DELETE_NOTE_JOB_NAME,
        data: {
          actorId: currentActor.id,
          statusId,
          // Captured here because the row above is already gone.
          to: originalStatus.to,
          cc: originalStatus.cc
        }
      })
    } catch (error) {
      // The local delete has committed and cannot be undone, so a failed
      // enqueue must not surface as a failed delete — that would tell the
      // author their post is still there when it is not. Remote copies
      // reconcile on their next fetch, which 404s.
      logger.error(
        { statusId, actorId: currentActor.id, err: toLoggableError(error) },
        'Failed to queue status delete federation'
      )
    }
  })
