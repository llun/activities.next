import type { Span } from '@opentelemetry/api'

import type { Database } from '@/lib/database/types'
import { DELIVER_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export const MAX_CONCURRENT_DELIVERY_PUBLICATIONS = 10

export const getDeliveryJobId = (
  parentMessageId: string,
  inbox: string
): string => {
  return getHashFromString(
    JSON.stringify([DELIVER_ACTIVITY_JOB_NAME, parentMessageId, inbox])
  )
}

export async function runWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  if (items.length === 0) return results

  const concurrency = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      try {
        const val = await fn(items[index])
        results[index] = { status: 'fulfilled', value: val }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
  return results
}

export interface EnqueueDeliveriesParams {
  database: Database
  parentMessageId: string
  actorId: string
  activity: Record<string, unknown>
  inboxes: readonly string[]
  span?: Span
  statusId?: string
}

export const enqueueDeliveries = async ({
  database,
  parentMessageId,
  actorId,
  activity,
  inboxes,
  span,
  statusId
}: EnqueueDeliveriesParams): Promise<void> => {
  const uniqueInboxes = Array.from(new Set(inboxes))

  let unavailableInboxes = new Set<string>()
  if (uniqueInboxes.length > 0) {
    try {
      unavailableInboxes = new Set(
        await database.getUnavailableInboxes({
          inboxes: uniqueInboxes
        })
      )
    } catch (error) {
      logger.error(
        { err: toLoggableError(error) },
        'enqueueDeliveries: failed to read unavailable inboxes, proceeding without filter'
      )
    }
  }

  const targetInboxes = uniqueInboxes.filter(
    (inbox) => !unavailableInboxes.has(inbox)
  )

  const skippedUnavailableCount = uniqueInboxes.length - targetInboxes.length
  span?.setAttribute('fanout.inbox_count', targetInboxes.length)
  span?.setAttribute(
    'fanout.skipped_unavailable_count',
    skippedUnavailableCount
  )

  const queue = getQueue()

  span?.addEvent('fanout_started', {
    'fanout.inbox_count': targetInboxes.length,
    'fanout.skipped_unavailable_count': skippedUnavailableCount,
    'fanout.actor_id': actorId,
    ...(statusId ? { 'fanout.status_id': statusId } : null),
    'queue.runs_inline': queue.runsInline
  })

  const results = await runWithConcurrencyLimit(
    targetInboxes,
    MAX_CONCURRENT_DELIVERY_PUBLICATIONS,
    (inbox) =>
      queue.publish({
        id: getDeliveryJobId(parentMessageId, inbox),
        name: DELIVER_ACTIVITY_JOB_NAME,
        data: {
          inbox,
          actorId,
          activity
        }
      })
  )

  if (queue.runsInline) {
    let failureCount = 0
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        failureCount++
        const err =
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason))
        span?.recordException(err)
        span?.addEvent('inbox_delivery_inline_error', {
          'delivery.inbox': targetInboxes[i],
          'error.message': err.message
        })
      }
    }

    span?.addEvent('fanout_completed', {
      'fanout.inbox_count': targetInboxes.length,
      'fanout.skipped_unavailable_count': skippedUnavailableCount,
      'fanout.failure_count': failureCount,
      'queue.runs_inline': true
    })
  } else {
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    )

    if (failures.length > 0) {
      const firstError =
        failures[0].reason instanceof Error
          ? failures[0].reason
          : new Error(String(failures[0].reason))
      const errorToThrow =
        failures.length === 1
          ? firstError
          : new AggregateError(
              failures.map((f) =>
                f.reason instanceof Error
                  ? f.reason
                  : new Error(String(f.reason))
              ),
              `Failed to publish ${failures.length} delivery jobs: ${firstError.message}`
            )
      span?.recordException(errorToThrow)
      span?.addEvent('fanout_failed', {
        'fanout.inbox_count': targetInboxes.length,
        'fanout.skipped_unavailable_count': skippedUnavailableCount,
        'fanout.failure_count': failures.length,
        'queue.runs_inline': false
      })
      throw errorToThrow
    }

    span?.addEvent('fanout_completed', {
      'fanout.inbox_count': targetInboxes.length,
      'fanout.skipped_unavailable_count': skippedUnavailableCount,
      'fanout.failure_count': 0,
      'queue.runs_inline': false
    })
  }
}
