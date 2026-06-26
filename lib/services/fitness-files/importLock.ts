import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'

// The TTL must comfortably exceed the QStash per-job timeout
// (MAX_JOB_TIMEOUT_SECONDS = 30s in lib/services/queue/qstash.ts): the worker
// running the locked critical section is killed at the job timeout, so a *live*
// holder can never outlive its lock and have it stolen mid-section. The
// steal-on-expiry path therefore only ever reclaims a lock from a holder whose
// worker already died (crash/OOM/SIGTERM) — never from one still executing — so
// two imports can't run the critical section concurrently. 120s gives ample
// margin over the 30s job cap.
export const IMPORT_LOCK_TTL_MS = 120 * 1000
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
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
