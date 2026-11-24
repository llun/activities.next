import type { Database } from '@/lib/database/types'
import { SYNC_BLUESKY_HOME_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export const BLUESKY_SYNC_INTERVAL_MS = 5 * 60 * 1000

/**
 * Publishes one Home sync job per linked account that still has a session.
 * The job id names the actor and the interval window, so a queue that
 * dedupes ids runs each actor at most once per window across instances.
 */
export const publishBlueskyHomeSyncs = async (
  database: Database,
  now = Date.now()
): Promise<number> => {
  const window = Math.floor(now / BLUESKY_SYNC_INTERVAL_MS)
  let published = 0
  for (const actorId of await database.listBlueskyAccountsToSync()) {
    try {
      await getQueue().publish({
        id: `bluesky-home:${actorId}:${window}`,
        name: SYNC_BLUESKY_HOME_JOB_NAME,
        data: { actorId }
      })
      published++
    } catch (error) {
      logger.error({
        message: 'Failed to publish Bluesky Home sync job',
        actorId,
        err: toLoggableError(error)
      })
    }
  }
  return published
}

/**
 * Runs `publishBlueskyHomeSyncs` every five minutes for the life of the
 * process, the way startActorDeletionSweep does: a tick schedules the next
 * only after it finishes, and the timer does not keep the process alive.
 */
export const startBlueskySyncSweep = (
  database: Database,
  { intervalMs = BLUESKY_SYNC_INTERVAL_MS }: { intervalMs?: number } = {}
): { stop: () => void } => {
  let stopped = false
  let timer: NodeJS.Timeout | null = null

  const schedule = () => {
    if (stopped) return
    timer = setTimeout(tick, intervalMs)
    timer.unref()
  }

  const tick = async () => {
    try {
      await publishBlueskyHomeSyncs(database)
    } catch (error) {
      logger.error({
        message: 'Bluesky Home sync sweep failed',
        err: toLoggableError(error)
      })
    }
    schedule()
  }

  schedule()
  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }
}
