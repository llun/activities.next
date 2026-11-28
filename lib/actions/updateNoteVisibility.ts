import {
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import type { BlueskyCrosspost } from '@/lib/database/domains/bluesky/types'
import { Database } from '@/lib/database/types'
import {
  DELETE_BLUESKY_CROSSPOST_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { BLUESKY_CROSSPOST_COLLISION_MESSAGE } from '@/lib/services/bluesky/crosspost'
import { deterministicTid } from '@/lib/services/bluesky/tid'
import { getCommunityForNewReply } from '@/lib/services/federation/replyCommunity'
import { getQueue } from '@/lib/services/queue'
import { DatabaseQueue } from '@/lib/services/queue/database'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Mention } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { getMentionFromTag } from '@/lib/types/domain/tag'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { MastodonVisibility, getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

interface UpdateNoteVisibilityFromUserInput {
  statusId: string
  currentActor: Actor
  visibility: MastodonVisibility
  publish?: boolean
  status?: StatusNote
  database: Database
}

// Drops the Bluesky copy of a post that is no longer public:
// - posted with a uri: queue DELETE_BLUESKY_CROSSPOST_JOB_NAME for that uri;
// - failed with BLUESKY_CROSSPOST_COLLISION_MESSAGE: a foreign record sits at
//   the deterministic TID, so drop the row with no job;
// - pending / posting / failed: a prior attempt may have written the record at
//   the deterministic TID without recording it, so queue
//   DELETE_BLUESKY_CROSSPOST_JOB_NAME for the deterministic uri with
//   expectedCreatedAt, under the DID the row was queued for (or the linked
//   account's, for a row written before the DID was recorded); if neither is
//   known, drop the row with no job. The delete job verifies via getRecord and
//   tolerates RecordNotFound, and skips a DID the actor no longer has linked;
// - on the database queue: delete the row and insert the queue job in one
//   transaction so a queue write failure rolls back and keeps the row;
// - on other queues: pending/posting rows are deleted first so an in-flight
//   worker's markBlueskyCrosspostPosted returns false and cleans up its record;
//   posted and failed rows stay intact until queue.publish succeeds so a
//   publish failure leaves the row for a later status deletion.
// Never throws: a Bluesky failure must not fail the visibility edit.
const removeBlueskyCrosspost = async (
  database: Database,
  {
    statusId,
    actorId,
    createdAt
  }: { statusId: string; actorId: string; createdAt: number }
) => {
  try {
    const queue = getQueue()
    const config = getConfig()
    const isDatabaseQueue =
      queue instanceof DatabaseQueue || config.queue?.type === 'database'
    const linkedDid =
      (await database.getBlueskyAccount({ actorId }))?.did ?? null
    const buildDeleteMessage = (crosspost: BlueskyCrosspost) => {
      if (crosspost.state === 'posted' && crosspost.uri) {
        return {
          id: getHashFromString(`${statusId}#bluesky-crosspost-delete`),
          name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
          data: { actorId, uri: crosspost.uri }
        }
      }
      const did = crosspost.did ?? linkedDid
      if (!did || crosspost.error === BLUESKY_CROSSPOST_COLLISION_MESSAGE) {
        return null
      }
      return {
        id: getHashFromString(`${statusId}#bluesky-crosspost-delete`),
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: {
          actorId,
          uri: `at://${did}/app.bsky.feed.post/${deterministicTid(createdAt, statusId)}`,
          expectedCreatedAt: new Date(createdAt).toISOString()
        }
      }
    }

    if (isDatabaseQueue) {
      const maxRetries =
        config.queue?.type === 'database' ? (config.queue.maxRetries ?? 16) : 16
      await database.deleteBlueskyCrosspostWithQueueJob({
        statusId,
        buildQueueJob: (crosspost) => {
          const message = buildDeleteMessage(crosspost)
          if (!message) return null
          return {
            id: message.id,
            name: message.name,
            payload: message,
            attempts: 0,
            maxRetries,
            nextRunAt: new Date(),
            status: 'pending'
          }
        }
      })
      return
    }

    const result = await database.deleteBlueskyCrosspostUnlessPosted({
      statusId
    })
    if (!result) return

    const message = buildDeleteMessage(result.crosspost)
    if (!message) {
      if (!result.deleted) {
        await database.deleteBlueskyCrosspost({ statusId })
      }
      return
    }

    try {
      await queue.publish(message)
    } catch (error) {
      logger.error(
        { statusId, actorId, err: toLoggableError(error) },
        'Failed to queue Bluesky cross-post delete'
      )
      return
    }

    if (!result.deleted) {
      await database.deleteBlueskyCrosspost({ statusId })
    }
  } catch (error) {
    logger.error(
      { statusId, actorId, err: toLoggableError(error) },
      'Failed to remove the Bluesky cross-post of a narrowed post'
    )
  }
}

export const updateNoteVisibilityFromUserInput = async ({
  statusId,
  currentActor,
  visibility,
  publish = true,
  status: preloadedStatus,
  database
}: UpdateNoteVisibilityFromUserInput) =>
  withSpan(
    'actions',
    'updateNoteVisibilityFromUser',
    { statusId },
    async () => {
      const status = preloadedStatus ?? (await database.getStatus({ statusId }))
      if (
        !status ||
        status.id !== statusId ||
        status.type !== StatusType.enum.Note ||
        status.actorId !== currentActor.id
      ) {
        return null
      }

      const mentions = status.tags
        .filter((tag) => tag.type === 'mention')
        .map((tag) => getMentionFromTag(tag))
        .filter((tag): tag is Mention => tag !== null)

      const replyStatus = status.reply
        ? await database.getStatus({
            statusId: status.reply,
            withReplies: false
          })
        : null

      // Keep (or gain) the community when going public/unlisted
      const communityActorId = await getCommunityForNewReply({
        database,
        replyStatus,
        visibility
      })

      const to = statusRecipientsTo(
        currentActor,
        mentions,
        replyStatus,
        visibility
      )
      const cc = statusRecipientsCC(
        currentActor,
        mentions,
        replyStatus,
        visibility,
        undefined,
        communityActorId
      )
      const updatedStatus = await database.updateNoteVisibility({
        statusId,
        to,
        cc
      })
      if (!updatedStatus) {
        return null
      }

      // A cross-post only exists for a public post. Narrowing the audience
      // takes the Bluesky copy with it: a posted row queues a delete for its
      // uri, while a pending, posting or failed row (unless it hit a foreign
      // record) queues a verified delete of the deterministic key when an
      // account is linked. Best effort — a Bluesky failure must never fail the
      // visibility edit.
      const wasPublic =
        getVisibility(status.to, status.cc, currentActor.followersUrl) ===
        'public'
      const isPublic =
        getVisibility(
          updatedStatus.to,
          updatedStatus.cc,
          currentActor.followersUrl
        ) === 'public'
      if (wasPublic && !isPublic) {
        await removeBlueskyCrosspost(database, {
          statusId,
          actorId: currentActor.id,
          createdAt: status.createdAt
        })
      }

      await addStatusToTimelines(database, updatedStatus)

      if (publish) {
        await getQueue().publish({
          id: getHashFromString(
            `${statusId}#update/${updatedStatus.updatedAt}`
          ),
          name: SEND_UPDATE_NOTE_JOB_NAME,
          data: { actorId: currentActor.id, statusId }
        })
      }

      return updatedStatus
    }
  )
