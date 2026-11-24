import { getConfig } from '@/lib/config'
import type { DeletedBlueskyCrosspost } from '@/lib/database/domains/status/types'
import { Database } from '@/lib/database/types'
import {
  DELETE_BLUESKY_CROSSPOST_JOB_NAME,
  SEND_DELETE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { BLUESKY_CROSSPOST_COLLISION_MESSAGE } from '@/lib/services/bluesky/crosspost'
import { deterministicTid } from '@/lib/services/bluesky/tid'
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
    // - posted with uri: queue DELETE_BLUESKY_CROSSPOST_JOB_NAME for that uri
    // - failed with BLUESKY_CROSSPOST_COLLISION_MESSAGE: a foreign record sits
    //   at the deterministic TID, so skip
    // - pending / posting / failed: a prior attempt may have written the record
    //   at the deterministic TID without recording it, so queue
    //   DELETE_BLUESKY_CROSSPOST_JOB_NAME for that deterministic uri with
    //   expectedCreatedAt when a Bluesky account is linked (the delete job
    //   verifies via getRecord and tolerates RecordNotFound); if no account is
    //   linked, skip
    // - absent: nothing reached Bluesky
    const buildBlueskyCrosspostDeleteJobMessage = (
      crosspost: DeletedBlueskyCrosspost,
      linkedDid: string | null
    ) => {
      let uri: string | null = null
      let expectedCreatedAt: string | undefined
      if (crosspost.state === 'posted' && crosspost.uri) {
        uri = crosspost.uri
      } else if (
        linkedDid &&
        crosspost.error !== BLUESKY_CROSSPOST_COLLISION_MESSAGE
      ) {
        const statusCreatedAt =
          crosspost.statusCreatedAt ??
          (crosspost.statusId === originalStatus.id
            ? originalStatus.createdAt
            : null)
        if (statusCreatedAt !== null) {
          uri = `at://${linkedDid}/app.bsky.feed.post/${deterministicTid(statusCreatedAt, crosspost.statusId)}`
          expectedCreatedAt = new Date(statusCreatedAt).toISOString()
        }
      }
      if (!uri) return null
      return {
        id: getHashFromString(`${crosspost.statusId}#bluesky-crosspost-delete`),
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: {
          actorId: currentActor.id,
          uri,
          ...(expectedCreatedAt !== undefined ? { expectedCreatedAt } : null)
        }
      }
    }

    if (isDatabaseQueue) {
      const maxRetries =
        config.queue?.type === 'database' ? (config.queue.maxRetries ?? 16) : 16
      const linkedDid =
        (await database.getBlueskyAccount({ actorId: currentActor.id }))?.did ??
        null

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
            const message = buildBlueskyCrosspostDeleteJobMessage(
              crosspost,
              linkedDid
            )
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

    let linkedDid: string | null = null
    if (
      blueskyCrossposts.some(
        (crosspost) =>
          (crosspost.state !== 'posted' || !crosspost.uri) &&
          crosspost.error !== BLUESKY_CROSSPOST_COLLISION_MESSAGE
      )
    ) {
      try {
        linkedDid =
          (await database.getBlueskyAccount({ actorId: currentActor.id }))
            ?.did ?? null
      } catch (error) {
        logger.error(
          { statusId, actorId: currentActor.id, err: toLoggableError(error) },
          'Failed to look up Bluesky account for cross-post delete'
        )
      }
    }

    for (const crosspost of blueskyCrossposts) {
      const message = buildBlueskyCrosspostDeleteJobMessage(
        crosspost,
        linkedDid
      )
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
