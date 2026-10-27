import type { Database } from '@/lib/database/types'
import { IMPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { toArchiveLoggableError } from '@/lib/services/accountArchive/redact'
import {
  ACCOUNT_IMPORT_MAX_STUCK_MS,
  ACCOUNT_IMPORT_QUEUED_EXPIRY_MS,
  ACCOUNT_IMPORT_STUCK_AFTER_MS
} from '@/lib/services/accountImport/constants'
import { getAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import {
  parseImportProgress,
  serializeImportProgress
} from '@/lib/services/accountImport/progress'
import {
  getAccountImportContinuationJobId,
  isAccountImportActorUnavailable
} from '@/lib/services/accountImport/runner'
import type { JobMessage } from '@/lib/services/queue/type'
import type { AccountImport } from '@/lib/types/domain/accountImport'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

const STALE_IMPORT_PAGE_SIZE = 100
const REAPER_LEASE_MS = 30_000

const reapOne = async (
  database: Database,
  accountImport: AccountImport,
  now: number,
  schedule: ((message: JobMessage) => Promise<void>) | undefined,
  runsInline: boolean
): Promise<boolean> => {
  if (
    accountImport.status !== 'running' ||
    (accountImport.claimedUntil !== null && accountImport.claimedUntil > now) ||
    now - accountImport.updatedAt < ACCOUNT_IMPORT_STUCK_AFTER_MS
  ) {
    return false
  }

  const runToken = getHashFromString(
    `${accountImport.id}:reaper:${accountImport.cursor ?? ''}:${accountImport.updatedAt}`
  )
  const claim = await database.claimAccountImportRun({
    id: accountImport.id,
    runToken,
    leaseMs: REAPER_LEASE_MS
  })
  if (!claim.claimed) return false

  try {
    const actor = await database.getActorFromId({ id: accountImport.actorId })
    if (isAccountImportActorUnavailable(actor)) {
      const renewed = await database.renewAccountImportRun({
        id: accountImport.id,
        runToken,
        leaseMs: REAPER_LEASE_MS
      })
      if (!renewed) return false
      const failed = await database.updateAccountImport({
        id: accountImport.id,
        onlyIfStatus: ['running'],
        status: 'failed',
        lastErrorCode: 'actor_unavailable',
        finishedAt: now
      })
      if (failed) {
        const objectStore = getAccountImportObjectStore()
        if (objectStore) {
          const stillOwned = await database.renewAccountImportRun({
            id: accountImport.id,
            runToken,
            leaseMs: REAPER_LEASE_MS
          })
          if (!stillOwned) return false
          await objectStore
            .deleteUpload(accountImport)
            .catch((error: unknown) => {
              logger.error({
                message:
                  'Could not delete an unavailable actor account import upload',
                importId: accountImport.id,
                err: toArchiveLoggableError(error)
              })
            })
        }
      }
      return failed
    }

    if (now - accountImport.updatedAt >= ACCOUNT_IMPORT_MAX_STUCK_MS) {
      const renewed = await database.renewAccountImportRun({
        id: accountImport.id,
        runToken,
        leaseMs: REAPER_LEASE_MS
      })
      if (!renewed) return false
      const failed = await database.updateAccountImport({
        id: accountImport.id,
        onlyIfStatus: ['running'],
        status: 'failed',
        lastErrorCode: 'import_stuck',
        finishedAt: now
      })
      if (failed) {
        const objectStore = getAccountImportObjectStore()
        if (objectStore) {
          const stillOwned = await database.renewAccountImportRun({
            id: accountImport.id,
            runToken,
            leaseMs: REAPER_LEASE_MS
          })
          if (!stillOwned) return false
          await objectStore
            .deleteUpload(accountImport)
            .catch((error: unknown) => {
              logger.error({
                message: 'Could not delete a stuck account archive upload',
                importId: accountImport.id,
                err: toArchiveLoggableError(error)
              })
            })
        }
      }
      return failed
    }

    if (!schedule || runsInline) return false
    // The requeue must never repeat a queue id the import has already used
    // for this phase and cursor, so the reaper takes the next continuation
    // pass for itself and persists it before it publishes: a later sweep of
    // the same stuck row derives a fresh id the same way.
    const progress = parseImportProgress(accountImport.progress)
    const pass = progress.continuationCount + 1
    const marked = await database.updateAccountImport({
      id: accountImport.id,
      onlyIfStatus: ['running'],
      progress: serializeImportProgress({
        ...progress,
        continuationCount: pass
      })
    })
    if (!marked) return false
    const cursor = `${accountImport.phase ?? 'inspect'}:${accountImport.cursor ?? ''}`
    await schedule({
      id: getAccountImportContinuationJobId(accountImport.id, cursor, pass),
      name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { importId: accountImport.id, actorId: accountImport.actorId }
    })
    return true
  } catch (error) {
    logger.error({
      message: 'Failed to reap a stuck account archive import',
      importId: accountImport.id,
      err: toArchiveLoggableError(error)
    })
    return false
  } finally {
    await database.releaseAccountImportRun({
      id: accountImport.id,
      runToken
    })
  }
}

// An upload that was never started holds personal data in object storage for
// no reason; after the expiry bound the row fails with a code and the upload
// goes. The only-if-queued update is the race guard: a start that flipped the
// row to running first keeps its upload, and this sweep leaves it alone.
const expireOne = async (
  database: Database,
  accountImport: AccountImport,
  now: number
): Promise<boolean> => {
  const failed = await database.updateAccountImport({
    id: accountImport.id,
    onlyIfStatus: ['queued'],
    status: 'failed',
    lastErrorCode: 'upload_expired',
    finishedAt: now
  })
  if (!failed) return false
  const objectStore = getAccountImportObjectStore()
  if (objectStore) {
    await objectStore.deleteUpload(accountImport).catch((error: unknown) => {
      logger.error({
        message: 'Could not delete an expired account archive upload',
        importId: accountImport.id,
        err: toArchiveLoggableError(error)
      })
    })
  }
  return true
}

/**
 * Requeues expired import leases; old rows fail with a code-only error. The
 * same sweep expires queued uploads that were never started: they fail with
 * `upload_expired` and their upload is deleted.
 */
export const sweepStuckAccountImports = async (
  database: Database,
  now = Date.now(),
  schedule?: (message: JobMessage) => Promise<void>,
  runsInline = false
): Promise<number> => {
  let afterId: string | undefined
  let reaped = 0
  try {
    for (;;) {
      const staleImports = await database.getStaleAccountImports({
        now,
        before: now - ACCOUNT_IMPORT_STUCK_AFTER_MS,
        ...(afterId === undefined ? {} : { afterId }),
        limit: STALE_IMPORT_PAGE_SIZE
      })
      for (const accountImport of staleImports) {
        if (await reapOne(database, accountImport, now, schedule, runsInline)) {
          reaped += 1
        }
        afterId = accountImport.id
      }
      if (staleImports.length < STALE_IMPORT_PAGE_SIZE) break
    }
  } catch (error) {
    logger.error({
      message: 'Failed to sweep stuck account archive imports',
      err: toArchiveLoggableError(error)
    })
  }
  try {
    let queuedAfterId: string | undefined
    for (;;) {
      const expiredQueued = await database.getExpiredQueuedAccountImports({
        before: now - ACCOUNT_IMPORT_QUEUED_EXPIRY_MS,
        ...(queuedAfterId === undefined ? {} : { afterId: queuedAfterId }),
        limit: STALE_IMPORT_PAGE_SIZE
      })
      for (const accountImport of expiredQueued) {
        if (await expireOne(database, accountImport, now)) {
          reaped += 1
        }
        queuedAfterId = accountImport.id
      }
      if (expiredQueued.length < STALE_IMPORT_PAGE_SIZE) break
    }
  } catch (error) {
    logger.error({
      message: 'Failed to expire queued account archive uploads',
      err: toArchiveLoggableError(error)
    })
  }
  return reaped
}
