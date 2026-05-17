import { z } from 'zod'

import { sendNote } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { JobHandle } from '@/lib/services/queue/type'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusType } from '@/lib/types/domain/status'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { logger } from '@/lib/utils/logger'
import { UNFOLLOW_NETWORK_ERROR_CODES } from '@/lib/utils/response'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string()
})

export const sendNoteJob: JobHandle = createJobHandle(
  SEND_NOTE_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendNoteJob', async (span) => {
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

      const note = getNoteFromStatus(status)
      if (
        !note ||
        (status.type !== StatusType.enum.Note &&
          status.type !== StatusType.enum.Poll)
      ) {
        span.recordException(new Error('Failed to get note from status'))
        span.end()
        return
      }

      const federatedInboxes = await getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status
      })

      await Promise.all(
        federatedInboxes.map(async (inbox) => {
          try {
            await sendNote({
              currentActor: actor,
              inbox,
              note
            })
          } catch (e) {
            logger.error({ inbox }, `Fail to send note`)
            const nodeError = e as NodeJS.ErrnoException
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
