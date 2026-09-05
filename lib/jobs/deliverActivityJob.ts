import { z } from 'zod'

import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import {
  classifyDeliveryError,
  DeliveryDisposition,
  SalvageableDeliveryError
} from '@/lib/services/federation/deliveryError'
import { JobHandle } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { withSpan } from '@/lib/utils/trace'

import { createJobHandle } from './createJobHandle'
import { DELIVER_ACTIVITY_JOB_NAME } from './names'

export const DeliverActivityJobData = z.object({
  inbox: z.string().url(),
  actorId: z.string(),
  activity: z.record(z.string(), z.unknown())
})

export const deliverActivityJob: JobHandle = createJobHandle(
  DELIVER_ACTIVITY_JOB_NAME,
  async (database, message) => {
    await withSpan('job', DELIVER_ACTIVITY_JOB_NAME, {}, async (span) => {
      const parsed = DeliverActivityJobData.safeParse(message.data)
      if (!parsed.success) {
        span.recordException(new Error('Malformed deliver activity job data'))
        return
      }

      const { inbox, actorId, activity } = parsed.data
      span.setAttribute('inbox', inbox)
      span.setAttribute('actorId', actorId)

      const actor = await database.getActorFromId({ id: actorId })
      if (!actor) {
        logger.warn(
          { actorId, inbox },
          'DeliverActivityJob: actor not found, discarding'
        )
        return
      }

      const method = 'POST'
      try {
        const { statusCode } = await request({
          url: inbox,
          method,
          headers: activityPubRequestHeaders({
            url: inbox,
            method,
            signingActor: actor,
            content: activity
          }),
          body: JSON.stringify(activity)
        })

        if (statusCode === 200 || statusCode === 202) {
          return
        }

        const classification = classifyDeliveryError({ statusCode })
        if (classification.disposition === DeliveryDisposition.SALVAGEABLE) {
          throw new SalvageableDeliveryError(
            `Delivery to ${inbox} failed with salvageable status ${statusCode}`,
            { statusCode }
          )
        }

        logger.warn(
          { inbox, statusCode, reason: classification.reason },
          'DeliverActivityJob: delivery failed permanently (unsalvageable), discarding'
        )
      } catch (error) {
        if (error instanceof SalvageableDeliveryError) {
          throw error
        }

        const classification = classifyDeliveryError({ error })
        if (classification.disposition === DeliveryDisposition.SALVAGEABLE) {
          throw new SalvageableDeliveryError(
            `Delivery to ${inbox} encountered network failure: ${(error as Error).message}`,
            { originalError: error }
          )
        }

        logger.warn(
          { inbox, err: error, reason: classification.reason },
          'DeliverActivityJob: delivery failed unsalvageably, discarding'
        )
      }
    })
  }
)
