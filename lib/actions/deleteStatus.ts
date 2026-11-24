import { getConfig } from '@/lib/config'
import type { BlueskyCrosspost } from '@/lib/database/domains/bluesky/types'
import { Database } from '@/lib/database/types'
import {
  DELETE_BLUESKY_CROSSPOST_JOB_NAME,
  SEND_DELETE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { DatabaseQueue } from '@/lib/services/queue/database'
import { CreateQueueJobParams } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { isBlueskyStatus } from '@/lib/types/domain/status'
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
    // Never delete or federate a Delete for a Bluesky post or a local boost of one.
    if (!originalStatus || isBlueskyStatus(originalStatus)) {
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

    const queue = getQueue()
    const config = getConfig()
    const isDatabaseQueue =
      queue instanceof DatabaseQueue || config.queue?.type === 'database'

    const queueJobId = getHashFromString(`${statusId}#delete`)

    // Decide from the cross-post row(s) taken inside the status-deletion
    // transaction:
    // - posted with uri: queue DELETE_BLUESKY_CROSSPOST_JOB_NAME
    // - posting: nothing to queue; the in-flight attempt's
    //   markBlueskyCrosspostPosted will see the row gone (return false) and
    //   delete the record it just created
    // - pending / failed / absent: nothing reached Bluesky
    const buildBlueskyCrosspostDeleteJobMessage = (
      crosspost: BlueskyCrosspost
    ) => {
      if (crosspost.state !== 'posted' || !crosspost.uri) return null
      return {
        id: getHashFromString(`${crosspost.statusId}#bluesky-crosspost-delete`),
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: { actorId: currentActor.id, uri: crosspost.uri }
      }
    }

    if (isDatabaseQueue) {
      const maxRetries =
        config.queue?.type === 'database' ? (config.queue.maxRetries ?? 16) : 16

      const queueJob: CreateQueueJobParams = {
        id: queueJobId,
        name: SEND_DELETE_NOTE_JOB_NAME,
        payload: {
          id: queueJobId,
          name: SEND_DELETE_NOTE_JOB_NAME,
          data: {
            actorId: currentActor.id,
            statusId,
            to: originalStatus.to,
            cc: originalStatus.cc
          }
        },
        attempts: 0,
        maxRetries,
        nextRunAt: new Date(),
        status: 'pending'
      }

      await database.deleteStatusWithQueueJob({
        actorId: currentActor.id,
        statusId,
        queueJob,
        buildAdditionalQueueJobs: ({ blueskyCrossposts }) =>
          blueskyCrossposts.flatMap((crosspost) => {
            const message = buildBlueskyCrosspostDeleteJobMessage(crosspost)
            if (!message) return []
            return [
              {
                id: message.id,
                name: message.name,
                payload: message,
                attempts: 0,
                maxRetries,
                nextRunAt: new Date(),
                status: 'pending'
              }
            ]
          })
      })
      return
    }

    // Delete locally first so the status leaves the author's timelines
    // immediately, then federate the Tombstone in the background. Delivery used
    // to run inline ahead of this, so the response waited on every remote inbox
    // — and since resolving those inboxes also ran first, an error collecting
    // them abandoned the delete entirely. (The sends themselves never rejected:
    // postActivityToInbox swallows delivery failures.)
    const { deleted, blueskyCrossposts } = await database.deleteStatus({
      statusId,
      actorId: currentActor.id
    })
    if (!deleted) return

    try {
      await queue.publish({
        // Suffixed because the queue deduplicates on this id across job names
        // and the create/update jobs already publish under the bare status id.
        // Without it, deleting a status posted or edited within the dedup
        // window would be dropped and never federate.
        id: queueJobId,
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

    for (const crosspost of blueskyCrossposts) {
      const message = buildBlueskyCrosspostDeleteJobMessage(crosspost)
      if (!message) continue
      try {
        await queue.publish(message)
      } catch (error) {
        logger.error(
          {
            statusId: crosspost.statusId,
            actorId: currentActor.id,
            err: toLoggableError(error)
          },
          'Failed to queue Bluesky cross-post delete'
        )
      }
    }
  })
