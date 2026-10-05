import { Database } from '@/lib/database/types'
import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// How often a long-running server looks for scheduled deletions that came due
// without a job (see `sweepScheduledActorDeletions`), and how long after startup
// the first look happens.
export const ACTOR_DELETION_SWEEP_INTERVAL_MS = 10 * 60 * 1000
const ACTOR_DELETION_SWEEP_FIRST_DELAY_MS = 60 * 1000

// Behind a real queue every scheduled deletion has its own delayed job, so the
// sweep only picks up deletions that are overdue by more than this: a job still
// in flight is not published a second time.
const QUEUED_JOB_GRACE_MS = 5 * 60 * 1000

/**
 * Hand a scheduled actor deletion to the queue.
 *
 * An immediate deletion (`scheduledAt` null) is published now. A delayed one is
 * published with `delaySeconds` so a real queue (database, QStash, Cloud Tasks)
 * fires it when it comes due. The in-process queue has no scheduler and drops
 * delayed messages, so nothing is published for it: the sweep started in
 * `instrumentation.ts` picks the actor up once `deletionScheduledAt` passes.
 * `scheduledAt` rides along in the job data so `deleteActorJob` can discard a job
 * made obsolete by a cancel followed by a new schedule.
 */
export const publishActorDeletion = async ({
  actorId,
  scheduledAt
}: {
  actorId: string
  scheduledAt: Date | null
}): Promise<void> => {
  const queue = getQueue()
  if (!scheduledAt) {
    await queue.publish({
      id: `delete-actor-${actorId}-${Date.now()}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })
    return
  }

  if (queue.runsInline) {
    logger.info({
      message:
        'Actor deletion left for the periodic sweep: the in-process queue cannot delay a job',
      actorId,
      scheduledAt: scheduledAt.toISOString()
    })
    return
  }

  try {
    await queue.publish({
      id: `delete-actor-${actorId}-${scheduledAt.getTime()}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId, scheduledAt: scheduledAt.getTime() },
      delaySeconds: Math.max(
        1,
        Math.ceil((scheduledAt.getTime() - Date.now()) / 1000)
      )
    })
  } catch (error) {
    // The deletion is already recorded as scheduled; the sweep covers a job
    // the queue refused (for instance a delay beyond its plan's maximum).
    logger.error({
      message:
        'Failed to queue delayed actor deletion; the sweep will retry it',
      actorId,
      scheduledAt: scheduledAt.toISOString(),
      err: toLoggableError(error)
    })
  }
}

/**
 * Publish a `DeleteActorJob` for every actor whose scheduled deletion has come
 * due. This is the only thing that carries a delayed deletion out under the
 * in-process queue, and under a real queue it is the safety net for a delayed
 * job that was lost or never accepted. Returns how many jobs it published.
 */
export const sweepScheduledActorDeletions = async (
  database: Database,
  now: Date = new Date()
): Promise<number> => {
  const queue = getQueue()
  const dueBefore = new Date(
    now.getTime() - (queue.runsInline ? 0 : QUEUED_JOB_GRACE_MS)
  )
  const dueActors = await database.getActorsScheduledForDeletion({
    beforeDate: dueBefore
  })

  let published = 0
  for (const actor of dueActors) {
    try {
      await queue.publish({
        id: `delete-actor-${actor.id}-${now.getTime()}`,
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId: actor.id }
      })
      published++
    } catch (error) {
      logger.error({
        message: 'Failed to publish delete actor job from the sweep',
        actorId: actor.id,
        err: toLoggableError(error)
      })
    }
  }
  return published
}

/**
 * Run `sweepScheduledActorDeletions` for the life of the process. Ticks never
 * overlap (each schedules the next only after it finishes), a failing tick is
 * logged and retried on the next one, and the timer does not keep the process
 * alive.
 */
export const startActorDeletionSweep = (
  database: Database,
  {
    intervalMs = ACTOR_DELETION_SWEEP_INTERVAL_MS
  }: { intervalMs?: number } = {}
): { stop: () => void } => {
  let stopped = false
  let timer: NodeJS.Timeout | null = null

  const schedule = (delayMs: number) => {
    if (stopped) return
    timer = setTimeout(tick, delayMs)
    timer.unref()
  }

  const tick = async () => {
    try {
      const published = await sweepScheduledActorDeletions(database)
      if (published > 0) {
        logger.info({
          message: 'Published delete actor jobs for due scheduled deletions',
          count: published
        })
      }
    } catch (error) {
      logger.error({
        message: 'Scheduled actor deletion sweep failed',
        err: toLoggableError(error)
      })
    }
    schedule(intervalMs)
  }

  schedule(Math.min(intervalMs, ACTOR_DELETION_SWEEP_FIRST_DELAY_MS))
  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }
}
