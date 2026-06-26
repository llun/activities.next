import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'

// A lock is held only for the short critical section that scans for an
// overlapping sibling and creates/merges the post, so a generous TTL still
// recovers quickly from a crashed holder.
export const IMPORT_LOCK_TTL_MS = 60 * 1000
const DEFAULT_MAX_WAIT_MS = 15 * 1000
const DEFAULT_POLL_INTERVAL_MS = 250

export interface WithImportLockOptions {
  ttlMs?: number
  maxWaitMs?: number
  pollIntervalMs?: number
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs `fn` while holding a per-key import lock so that two imports for the
 * same actor can't race into creating duplicate posts. If the lock is held by
 * another import, this polls until it frees up (bounded by `maxWaitMs`). If it
 * still can't be acquired within the budget, `fn` runs anyway (best effort):
 * failing the import would be worse than the pre-lock behavior, which a later
 * retry/merge can still reconcile. The lock is always released when `fn`
 * settles.
 */
export const withImportLock = async <T>(
  database: Database,
  lockKey: string,
  fn: () => Promise<T>,
  options: WithImportLockOptions = {}
): Promise<T> => {
  const ttlMs = options.ttlMs ?? IMPORT_LOCK_TTL_MS
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  const deadline = Date.now() + maxWaitMs
  let lock = await database.acquireImportLock({ lockKey, ttlMs })
  while (!lock && Date.now() < deadline) {
    await delay(pollIntervalMs)
    lock = await database.acquireImportLock({ lockKey, ttlMs })
  }

  if (!lock) {
    logger.warn({
      message: 'Proceeding without import lock after wait timeout',
      lockKey,
      maxWaitMs
    })
    return fn()
  }

  try {
    return await fn()
  } finally {
    try {
      await database.releaseImportLock({ lockKey, token: lock.token })
    } catch (error) {
      logger.warn({
        message: 'Failed to release import lock',
        lockKey,
        error: (error as Error).message
      })
    }
  }
}
