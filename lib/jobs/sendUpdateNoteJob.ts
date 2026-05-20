import { z } from 'zod'

import { sendUpdateNote } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { JobHandle } from '@/lib/services/queue/type'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusType } from '@/lib/types/domain/status'
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

      const uniqueInboxes = await getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status
      })
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
