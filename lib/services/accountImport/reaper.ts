import { getConfig } from '@/lib/config'
import type { Database } from '@/lib/database/types'
import { IMPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { toArchiveLoggableError } from '@/lib/services/accountArchive/redact'
import {
  ACCOUNT_IMPORT_MAX_STUCK_MS,
  ACCOUNT_IMPORT_STUCK_AFTER_MS
} from '@/lib/services/accountImport/constants'
import { getAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { getAccountImportContinuationJobId } from '@/lib/services/accountImport/runner'
import type { JobMessage } from '@/lib/services/queue/type'
import type { AccountImport } from '@/lib/types/domain/accountImport'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

const ACTOR_PAGE_SIZE = 100
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
    const cursor = `${accountImport.phase ?? 'inspect'}:${accountImport.cursor ?? ''}`
    await schedule({
      id: getAccountImportContinuationJobId(accountImport.id, cursor),
      name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { importId: accountImport.id, actorId: accountImport.actorId }
    })
    return true
  } catch (error) {
    logger.error({
      message: 'Failed to requeue a stuck account archive import',
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

/** Requeues expired import leases; old rows fail with a code-only error. */
export const sweepStuckAccountImports = async (
  database: Database,
  now = Date.now(),
  schedule?: (message: JobMessage) => Promise<void>,
  runsInline = false
): Promise<number> => {
  let actorOffset = 0
  let reaped = 0
  try {
    for (;;) {
      const actors = await database.getLocalMastodonActors({
        localDomain: getConfig().host,
        local: true,
        order: 'new',
        offset: actorOffset,
        limit: ACTOR_PAGE_SIZE
      })
      for (const actor of actors) {
        // Mastodon Account ids may use the public client-facing encoding; `uri`
        // is the stored ActivityPub actor id used by account_imports.actorId.
        const actorId = actor.uri
        if (!actorId) continue
        const active = await database.getActiveAccountImport({
          actorId
        })
        if (
          active &&
          (await reapOne(database, active, now, schedule, runsInline))
        ) {
          reaped += 1
        }
      }
      if (actors.length < ACTOR_PAGE_SIZE) break
      actorOffset += ACTOR_PAGE_SIZE
    }
  } catch (error) {
    logger.error({
      message: 'Failed to sweep stuck account archive imports',
      err: toArchiveLoggableError(error)
    })
  }
  return reaped
}
