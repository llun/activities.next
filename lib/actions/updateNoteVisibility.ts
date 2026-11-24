import {
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  DELETE_BLUESKY_CROSSPOST_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
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
// - pending / posting / failed: delete the row with no job; if a cross-post
//   attempt was in flight ('posting'), deleting the row makes
//   markBlueskyCrosspostPosted return false so crosspostStatus immediately
//   deletes the newly created Bluesky record;
// - posted with a uri on the database queue: delete the row and insert
//   DELETE_BLUESKY_CROSSPOST_JOB_NAME in one transaction so a queue write
//   failure rolls back and keeps the row;
// - posted with a uri on other queues: publish the delete job first and delete
//   the row only after the publish succeeded, so a publish failure leaves the
//   row intact for a later status deletion.
// Never throws: a Bluesky failure must not fail the visibility edit.
const removeBlueskyCrosspost = async (
  database: Database,
  { statusId, actorId }: { statusId: string; actorId: string }
) => {
  try {
    const queue = getQueue()
    const config = getConfig()
    const isDatabaseQueue =
      queue instanceof DatabaseQueue || config.queue?.type === 'database'
    const buildDeleteMessage = (uri: string) => ({
      id: getHashFromString(`${statusId}#bluesky-crosspost-delete`),
      name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
      data: { actorId, uri }
    })

    if (isDatabaseQueue) {
      const maxRetries =
        config.queue?.type === 'database' ? (config.queue.maxRetries ?? 16) : 16
      await database.deleteBlueskyCrosspostWithQueueJob({
        statusId,
        buildQueueJob: (crosspost) => {
          if (crosspost.state !== 'posted' || !crosspost.uri) return null
          const message = buildDeleteMessage(crosspost.uri)
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

    const posted = await database.deleteBlueskyCrosspostUnlessPosted({
      statusId
    })
    if (!posted?.uri) return

    try {
      await queue.publish(buildDeleteMessage(posted.uri))
    } catch (error) {
      logger.error(
        { statusId, actorId, err: toLoggableError(error) },
        'Failed to queue Bluesky cross-post delete'
      )
      return
    }

    await database.deleteBlueskyCrosspost({ statusId })
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
      // takes the Bluesky copy with it: a pending or failed row is dropped, and
      // a posted one is deleted on Bluesky first. Best effort — a Bluesky
      // failure must never fail the visibility edit.
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
          actorId: currentActor.id
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
