import { z } from 'zod'

import { CreateStatus } from '@/lib/activities/createStatus'
import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { loadStatusAndActor } from '@/lib/jobs/loadStatusAndActor'
import { DELIVER_ACTIVITY_JOB_NAME, SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { getQueue } from '@/lib/services/queue'
import { JobHandle } from '@/lib/services/queue/type'
import { CreateAction } from '@/lib/types/activitypub/activities'
import { StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { withSpan } from '@/lib/utils/trace'

export const MAX_CONCURRENT_DELIVERY_PUBLICATIONS = 10

export const getDeliveryJobId = (
  parentMessageId: string,
  inbox: string
): string => {
  return getHashFromString(
    JSON.stringify([DELIVER_ACTIVITY_JOB_NAME, parentMessageId, inbox])
  )
}

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string()
})

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

export const sendNoteJob: JobHandle = createJobHandle(
  SEND_NOTE_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'sendNote', {}, async (span) => {
      const { actorId, statusId } = JobData.parse(message.data)
      const { status, actor } = await loadStatusAndActor(database, span, {
        actorId,
        statusId
      })

      if (!status || !actor) {
        span.recordException(new Error('Status or actor not found'))
        return
      }

      const note = getNoteFromStatus(status)
      if (
        !note ||
        (status.type !== StatusType.enum.Note &&
          status.type !== StatusType.enum.Poll)
      ) {
        span.recordException(new Error('Failed to get note from status'))
        return
      }

      const federatedInboxes = await getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status
      })

      const inboxes = Array.from(new Set(federatedInboxes))

      const activity: CreateStatus = {
        '@context': NOTE_ACTIVITY_CONTEXT,
        id: note.id,
        type: CreateAction,
        actor: note.attributedTo,
        published: note.published,
        to: note.to,
        cc: note.cc,
        object: note
      }

      const queue = getQueue()

      span.addEvent('fanout_started', {
        'fanout.inbox_count': inboxes.length,
        'fanout.actor_id': actor.id,
        'fanout.status_id': status.id,
        'queue.runs_inline': queue.runsInline
      })

      const results = await runWithConcurrencyLimit(
        inboxes,
        MAX_CONCURRENT_DELIVERY_PUBLICATIONS,
        (inbox) =>
          queue.publish({
            id: getDeliveryJobId(message.id, inbox),
            name: DELIVER_ACTIVITY_JOB_NAME,
            data: {
              inbox,
              actorId: actor.id,
              activity: activity as unknown as Record<string, unknown>
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
            span.addEvent('inbox_delivery_inline_error', {
              'delivery.inbox': inboxes[i],
              'error.message': err.message
            })
          }
        }

        span.addEvent('fanout_completed', {
          'fanout.inbox_count': inboxes.length,
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
          span.recordException(errorToThrow)
          span.addEvent('fanout_failed', {
            'fanout.inbox_count': inboxes.length,
            'fanout.failure_count': failures.length,
            'queue.runs_inline': false
          })
          throw errorToThrow
        }

        span.addEvent('fanout_completed', {
          'fanout.inbox_count': inboxes.length,
          'fanout.failure_count': 0,
          'queue.runs_inline': false
        })
      }
    })
  }
)
