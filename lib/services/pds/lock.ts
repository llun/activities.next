import crypto from 'node:crypto'

import type { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { PdsLockTimeoutError } from './errors'

const DEFAULT_LOCK_TTL_MS = 30 * 1000
const DEFAULT_LOCK_WAIT_MS = 30 * 1000
const DEFAULT_LOCK_POLL_MS = 25

// Per-database in-process queue so concurrent writers on the same process hand
// off immediately without waiting for a poll tick, while the DB lock serializes
// across multiple server processes.
const processQueues = new WeakMap<Database, Map<string, Promise<void>>>()

const getProcessQueueMap = (database: Database): Map<string, Promise<void>> => {
  let map = processQueues.get(database)
  if (!map) {
    map = new Map()
    processQueues.set(database, map)
  }
  return map
}

const getPdsRepoLockKey = (did: string): string =>
  `pds:repo:${crypto.createHash('sha256').update(did).digest('hex')}`

const withInProcessQueue = async <T>(
  database: Database,
  key: string,
  fn: () => Promise<T>
): Promise<T> => {
  const queues = getProcessQueueMap(database)
  const previous = queues.get(key) ?? Promise.resolve()

  let releaseNext!: () => void
  const current = new Promise<void>((resolve) => {
    releaseNext = resolve
  })
  const tail = previous.then(() => current)
  queues.set(key, tail)

  await previous
  try {
    return await fn()
  } finally {
    releaseNext()
    if (queues.get(key) === tail) {
      queues.delete(key)
    }
  }
}

export type PdsRepoLockOptions = {
  ttlMs?: number
  waitMs?: number
  pollMs?: number
}

/**
 * Serializes writes to a single PDS repo across both concurrent calls in this
 * process and multiple server instances via the shared database lock table.
 */
export const withPdsRepoLock = async <T>(
  database: Database,
  did: string,
  fn: () => Promise<T>,
  {
    ttlMs = DEFAULT_LOCK_TTL_MS,
    waitMs = DEFAULT_LOCK_WAIT_MS,
    pollMs = DEFAULT_LOCK_POLL_MS
  }: PdsRepoLockOptions = {}
): Promise<T> => {
  const lockKey = getPdsRepoLockKey(did)
  return withInProcessQueue(database, lockKey, async () => {
    const deadline = Date.now() + waitMs
    for (;;) {
      const lock = await database.acquireImportLock({
        lockKey,
        ttlMs
      })
      if (lock) {
        try {
          return await fn()
        } finally {
          try {
            await database.releaseImportLock({ lockKey, token: lock.token })
          } catch (err) {
            logger.error({
              message: 'Failed to release PDS repo lock',
              did,
              lockKey,
              err: toLoggableError(err)
            })
          }
        }
      }
      if (Date.now() > deadline) {
        throw new PdsLockTimeoutError(did)
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  })
}
