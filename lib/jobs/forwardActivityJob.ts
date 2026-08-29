import { z } from 'zod'

import { forwardActivity } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { FORWARD_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

export const ForwardActivityJobData = z.object({
  activity: z.record(z.string(), z.unknown()),
  inboxes: z.string().array(),
  localActorId: z.string().optional()
})

export const forwardActivityJob: JobHandle = createJobHandle(
  FORWARD_ACTIVITY_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'forwardActivity', {}, async (span) => {
      const parsed = ForwardActivityJobData.safeParse(message.data)
      if (!parsed.success) {
        span.recordException(new Error('Malformed forward activity job data'))
        return
      }

      const { activity, inboxes, localActorId } = parsed.data
      const activityId = typeof activity.id === 'string' ? activity.id : ''

      let signingActor: Actor | null | undefined = null
      if (localActorId) {
        const localActor = await database.getActorFromId({ id: localActorId })
        if (localActor?.privateKey) {
          signingActor = localActor
        }
      }

      if (!signingActor) {
        signingActor = await getFederationSigningActor(database)
      }

      if (!signingActor) {
        span.recordException(
          new Error('No signing actor available for inbox forwarding')
        )
        logger.error('No signing actor available for forwardActivityJob')
        return
      }

      span.setAttribute('inbox.forward_targets_count', inboxes.length)
      span.setAttribute('inbox.local_actor_id', localActorId ?? signingActor.id)
      span.setAttribute('inbox.activity_id', activityId)

      await Promise.all(
        inboxes.map(async (inbox) => {
          try {
            await forwardActivity({
              signingActor,
              inbox,
              activity
            })
          } catch (error) {
            logger.error({
              err: toLoggableError(error),
              inbox,
              activityId,
              message: 'Failed to forward activity to inbox'
            })
          }
        })
      )
    })
  }
)
