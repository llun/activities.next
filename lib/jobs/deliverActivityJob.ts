import { SpanStatusCode, trace } from '@opentelemetry/api'
import { z } from 'zod'

import { signedActivityPubRequest } from '@/lib/activities/signedRequest'
import {
  DeliveryDisposition,
  SalvageableDeliveryError,
  classifyDeliveryError
} from '@/lib/services/federation/deliveryError'
import { getDomainFromUrl } from '@/lib/services/federation/domainPolicy'
import { JobHandle } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'
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
    const domain = getDomainFromUrl(inbox)
    span?.setAttribute('inbox', inbox)
    span?.setAttribute('actorId', actorId)

    if (domain) {
      let inboxUnavailable = false
      try {
        inboxUnavailable = await database.isInboxUnavailable({ inbox })
      } catch (trackingError) {
        logger.error(
          { err: toLoggableError(trackingError), domain, inbox },
          'DeliverActivityJob: failed to check inbox availability'
        )
      }

      if (inboxUnavailable) {
        span?.addEvent('delivery_skipped_unavailable_inbox', {
          'delivery.inbox': inbox,
          'delivery.domain': domain,
          'delivery.actor_id': actorId,
          'delivery.activity_type': String(activity.type)
        })
        logger.info(
          { inbox, domain, actorId },
          'DeliverActivityJob: skipping delivery to unavailable inbox'
        )
        return
      }
    }

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

    const recordSalvageableFailure = async (reason: string) => {
      if (!domain) return
      try {
        const markedUnavailable = await database.recordDeliveryFailure({
          inbox,
          error: reason,
          now: Date.now()
        })
        if (markedUnavailable) {
          logger.warn(
            { domain, inbox },
            'DeliverActivityJob: inbox marked unavailable after repeated delivery failures'
          )
        }
      } catch (trackingError) {
        logger.error(
          { err: toLoggableError(trackingError), domain, inbox },
          'DeliverActivityJob: failed to record inbox delivery failure'
        )
      }
    }

    const method = 'POST'
    try {
      const { statusCode } = await signedActivityPubRequest({
        actor,
        method,
        url: inbox,
        body: JSON.stringify(activity)
      })

      if (statusCode !== undefined && statusCode >= 200 && statusCode < 300) {
        if (domain) {
          try {
            await database.clearDeliveryFailures({ inbox })
          } catch (trackingError) {
            logger.error(
              { err: toLoggableError(trackingError), domain, inbox },
              'DeliverActivityJob: failed to clear inbox delivery failures'
            )
          }
        }
        span?.addEvent('delivery_success', {
          'delivery.inbox': inbox,
          'delivery.status_code': statusCode
        })
        return
      }

      const classification = classifyDeliveryError({ statusCode })
      if (classification.disposition === DeliveryDisposition.SALVAGEABLE) {
        if (statusCode !== 401) {
          await recordSalvageableFailure(classification.reason)
        }
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

      // Network errors (DNS failures, timeouts, resets, TLS certificate errors)
      // never touch follow state: the classification below retries them
      // through the queue's normal backoff, like Mastodon does.
      const classification = classifyDeliveryError({ error })
      if (classification.disposition === DeliveryDisposition.SALVAGEABLE) {
        await recordSalvageableFailure(classification.reason)
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
        { inbox, err: toLoggableError(error), reason: classification.reason },
        'DeliverActivityJob: delivery failed unsalvageably, discarding'
      )
    }
  }
)
