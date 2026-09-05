import { SpanStatusCode, trace } from '@opentelemetry/api'
import { z } from 'zod'

import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import {
  DeliveryDisposition,
  SalvageableDeliveryError,
  classifyDeliveryError
} from '@/lib/services/federation/deliveryError'
import { JobHandle } from '@/lib/services/queue/type'
import { FollowStatus } from '@/lib/types/domain/follow'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { UNFOLLOW_NETWORK_ERROR_CODES } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'

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
    const span = trace.getActiveSpan()
    const parsed = DeliverActivityJobData.safeParse(message.data)
    if (!parsed.success) {
      span?.recordException(new Error('Malformed deliver activity job data'))
      return
    }

    const { inbox, actorId, activity } = parsed.data
    span?.setAttribute('inbox', inbox)
    span?.setAttribute('actorId', actorId)

    span?.addEvent('delivery_attempt_start', {
      'delivery.inbox': inbox,
      'delivery.actor_id': actorId,
      'delivery.activity_type': String(activity.type)
    })

    const actor = await database.getActorFromId({ id: actorId })
    if (!actor) {
      span?.addEvent('delivery_unsalvageable_discarded', {
        'delivery.inbox': inbox,
        'delivery.reason': 'actor_not_found',
        'delivery.salvageable': false
      })
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
        span?.addEvent('delivery_success', {
          'delivery.inbox': inbox,
          'delivery.status_code': statusCode
        })
        return
      }

      const classification = classifyDeliveryError({ statusCode })
      if (classification.disposition === DeliveryDisposition.SALVAGEABLE) {
        const errMessage = `Delivery to ${inbox} failed with salvageable status ${statusCode}`
        span?.addEvent('delivery_salvageable_failure', {
          'delivery.inbox': inbox,
          'delivery.status_code': statusCode ?? 0,
          'delivery.reason': classification.reason,
          'delivery.salvageable': true,
          'error.message': errMessage
        })
        const err = new SalvageableDeliveryError(errMessage, { statusCode })
        span?.recordException(err)
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message
        })
        throw err
      }

      span?.addEvent('delivery_unsalvageable_discarded', {
        'delivery.inbox': inbox,
        'delivery.status_code': statusCode ?? 0,
        'delivery.reason': classification.reason,
        'delivery.salvageable': false
      })
      logger.warn(
        { inbox, statusCode, reason: classification.reason },
        'DeliverActivityJob: delivery failed permanently (unsalvageable), discarding'
      )
    } catch (error) {
      if (error instanceof SalvageableDeliveryError) {
        throw error
      }

      const nodeError = error as NodeJS.ErrnoException | null | undefined
      if (
        nodeError?.code &&
        UNFOLLOW_NETWORK_ERROR_CODES.includes(nodeError.code)
      ) {
        try {
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
          span?.addEvent('delivery_follower_unfollowed', {
            'delivery.inbox': inbox,
            'delivery.unfollowed_count': follows.length,
            'error.code': nodeError.code
          })
        } catch (unfollowError) {
          logger.warn(
            { inbox, err: toLoggableError(unfollowError) },
            'DeliverActivityJob: failed to reject follow for failing inbox'
          )
        }
      }

      const classification = classifyDeliveryError({ error })
      if (classification.disposition === DeliveryDisposition.SALVAGEABLE) {
        const errMessage = `Delivery to ${inbox} encountered network failure: ${(error as Error).message}`
        span?.addEvent('delivery_salvageable_failure', {
          'delivery.inbox': inbox,
          'delivery.status_code': 0,
          'delivery.reason': classification.reason,
          'delivery.salvageable': true,
          'error.message': errMessage
        })
        const err = new SalvageableDeliveryError(errMessage, {
          originalError: error
        })
        span?.recordException(err)
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message
        })
        throw err
      }

      span?.addEvent('delivery_unsalvageable_discarded', {
        'delivery.inbox': inbox,
        'delivery.status_code': 0,
        'delivery.reason': classification.reason,
        'delivery.salvageable': false
      })
      logger.warn(
        { inbox, err: error, reason: classification.reason },
        'DeliverActivityJob: delivery failed unsalvageably, discarding'
      )
    }
  }
)
