import type { Database } from '@/lib/database/types'
import { EXPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { AccountArchive } from '@/lib/types/domain/accountArchive'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { discardUnfinishedArchive } from './expiry'
import { type ArchiveObjectStore, getArchiveObjectStore } from './objectStore'
import { parseProgress } from './progress'
import { toArchiveLoggableError } from './redact'

/** A queued or running export that has not moved for this long is stuck. */
export const ARCHIVE_STUCK_AFTER_MS = 60 * 60 * 1000
/** An export is requeued this many times before it is given up on. */
export const ARCHIVE_MAX_REAPS = 3
const SWEEP_BATCH = 50

export const isArchiveStuck = (
  archive: AccountArchive,
  now: number,
  stuckAfterMs = ARCHIVE_STUCK_AFTER_MS
) =>
  (archive.status === 'queued' || archive.status === 'running') &&
  now - archive.heartbeatAt >= stuckAfterMs

/**
 * Deals with one export that stopped moving (its worker died, or the queue lost
 * the message): requeues its current slice when a queue can deliver it, and
 * marks it failed, with its files and unfinished upload discarded, when it
 * cannot or when it has been requeued `ARCHIVE_MAX_REAPS` times already. Each
 * requeue moves the heartbeat, so the next check is an hour away. A failed
 * export does not count against the 7-day request limit. Returns the row as it
 * now is.
 */
export const reapStuckAccountArchive = async ({
  database,
  archive,
  store = getArchiveObjectStore(),
  now = Date.now
}: {
  database: Database
  archive: AccountArchive
  store?: ArchiveObjectStore | null
  now?: () => number
}): Promise<AccountArchive> => {
  if (!isArchiveStuck(archive, now())) return archive

  const queue = getQueue()
  if (queue.runsInline || archive.reapCount >= ARCHIVE_MAX_REAPS) {
    const failed = await database.updateAccountArchive({
      id: archive.id,
      onlyIfStatus: ['queued', 'running'],
      // Not if the export resumed since the row was read: its files are in use.
      onlyIfProgress: archive.progress,
      onlyIfReapCount: archive.reapCount,
      status: 'failed',
      error: 'The export stopped making progress',
      progress: null
    })
    if (!failed) return archive
    if (store)
      await discardUnfinishedArchive(store, archive).catch(() => undefined)
    return failed
  }

  const progress = parseProgress(archive.progress)
  const marked = await database.updateAccountArchive({
    id: archive.id,
    onlyIfStatus: ['queued', 'running'],
    // Only one sweep or request wins the requeue of a given cursor, and of a
    // row that never saved one.
    onlyIfProgress: archive.progress,
    onlyIfReapCount: archive.reapCount,
    reapCount: archive.reapCount + 1,
    heartbeatAt: now()
  })
  if (!marked) return archive

  try {
    await queue.publish({
      id: getHashFromString(`${archive.id}:reap:${marked.reapCount}`),
      name: EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { archiveId: archive.id, slice: (progress?.completed ?? -1) + 1 }
    })
  } catch (error) {
    logger.error({
      message: 'Failed to requeue a stuck account archive export',
      archiveId: archive.id,
      err: toArchiveLoggableError(error)
    })
  }
  return marked
}

/** Reaps every stuck export; the periodic sweep runs this beside the expiry. */
export const sweepStuckAccountArchives = async (
  database: Database,
  now: number = Date.now()
): Promise<number> => {
  const candidates = await database.getStaleAccountArchives({
    before: now - ARCHIVE_STUCK_AFTER_MS,
    limit: SWEEP_BATCH
  })
  let reaped = 0
  for (const archive of candidates) {
    try {
      const result = await reapStuckAccountArchive({
        database,
        archive,
        now: () => now
      })
      if (result !== archive) reaped += 1
    } catch (error) {
      logger.error({
        message: 'Failed to reap an account archive export',
        archiveId: archive.id,
        err: toArchiveLoggableError(error)
      })
    }
  }
  return reaped
}
