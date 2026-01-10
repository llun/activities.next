import { z } from 'zod'

import { sendUpdateNote } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { FollowStatus } from '@/lib/models/follow'
import { StatusType } from '@/lib/models/status'
import { JobHandle } from '@/lib/services/queue/type'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'
import { UNFOLLOW_NETWORK_ERROR_CODES } from '@/lib/utils/response'
import { getTracer } from '@/lib/utils/trace'

/**
 * Job data schema for sending note updates
 */
export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string()
})

/**
 * Job handler for sending note updates to federated actors
 *
 * This job fetches the status and actor, then sends update activities
 * to all relevant inboxes based on the note's to/cc fields
 */
export const sendUpdateNoteJob: JobHandle = createJobHandle(
  SEND_UPDATE_NOTE_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendUpdateNoteJob', async (span) => {
      const { actorId, statusId } = JobData.parse(message.data)
      span.setAttribute('actorId', actorId)
      span.setAttribute('statusId', statusId)

      const [status, actor] = await Promise.all([
        database.getStatus({
          statusId,
          withReplies: false
        }),
        database.getActorFromId({
          id: actorId
        })
      ])

      if (!status || !actor) {
        span.recordException(new Error('Status or actor not found'))
        span.end()
        return
      }

      if (status.type !== StatusType.enum.Note) {
        span.recordException(new Error('Status is not a Note'))
        span.end()
        return
      }

      const inboxes = []
      if (
        status.to.includes(ACTIVITY_STREAM_PUBLIC) ||
        status.to.includes(ACTIVITY_STREAM_PUBLIC_COMPACT) ||
        status.cc.includes(ACTIVITY_STREAM_PUBLIC) ||
        status.cc.includes(ACTIVITY_STREAM_PUBLIC_COMPACT)
      ) {
        const followersInbox = await database.getFollowersInbox({
          targetActorId: actor.id
        })
        inboxes.push(...followersInbox)
      }

      const toInboxes = (
        await Promise.all(
          [...status.to, ...status.cc]
            .filter(
              (item) =>
                item !== ACTIVITY_STREAM_PUBLIC &&
                item !== ACTIVITY_STREAM_PUBLIC_COMPACT
            )
            .map(async (item) => database.getActorFromId({ id: item }))
        )
      )
        .filter((actor): actor is NonNullable<typeof actor> => Boolean(actor))
        .map((actor) => actor.sharedInboxUrl || actor.inboxUrl)
      inboxes.push(...toInboxes)

      const uniqueInboxes = [...new Set(inboxes)]
      await Promise.all(
        uniqueInboxes.map(async (inbox) => {
          try {
            await sendUpdateNote({
              currentActor: actor,
              inbox,
              status
            })
          } catch (e) {
            const nodeError = e as NodeJS.ErrnoException
            logger.error(
              {
                inbox,
                error: nodeError.message,
                code: nodeError.code
              },
              'Failed to update note'
            )
            if (UNFOLLOW_NETWORK_ERROR_CODES.includes(nodeError.code ?? '')) {
              const follows = await database.getLocalFollowsFromInboxUrl({
                followerInboxUrl: inbox,
                targetActorId: actor.id
              })
              await Promise.all(
                follows.map((follow) =>
                  database.updateFollowStatus({
                    followId: follow.id,
                    status: FollowStatus.enum.Rejected
                  })
                )
              )
            }
          }
        })
      )

      span.end()
    })
  }
)
