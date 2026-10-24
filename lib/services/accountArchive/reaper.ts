import type { Database } from '@/lib/database/types'
import { EXPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { AccountArchive } from '@/lib/types/domain/accountArchive'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { deleteArchiveFiles } from './expiry'
import { type ArchiveObjectStore, getArchiveObjectStore } from './objectStore'
import { parseProgress, serializeProgress } from './progress'

/** A queued or running export with no progress for this long is stuck. */
export const ARCHIVE_STUCK_AFTER_MS = 60 * 60 * 1000
/** An export is requeued this many times before it is given up on. */
export const ARCHIVE_MAX_REAPS = 3
const REAP_MARKER = 'reaped:'
const SWEEP_BATCH = 50

const getReaps = (archive: AccountArchive) => {
  if (!archive.error?.startsWith(REAP_MARKER)) return 0
  const count = Number(archive.error.slice(REAP_MARKER.length))
  return Number.isInteger(count) && count > 0 ? count : 0
}

export const isArchiveStuck = (
  archive: AccountArchive,
  now: number,
  stuckAfterMs = ARCHIVE_STUCK_AFTER_MS
) => {
  if (archive.status !== 'queued' && archive.status !== 'running') return false
  const last = parseProgress(archive.progress)?.updatedAt ?? archive.createdAt
  return now - last >= stuckAfterMs
}

/**
 * Deals with one export that stopped moving (its worker died, or the queue lost
 * the message): requeues its current slice when a queue can deliver it, and
 * marks it failed, with its staged parts deleted, when it cannot or when it has
 * been requeued `ARCHIVE_MAX_REAPS` times already. A failed export does not
 * count against the 7-day request limit. Returns the row as it now is.
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
  const reaps = getReaps(archive)
  if (queue.runsInline || reaps >= ARCHIVE_MAX_REAPS) {
    const failed = await database.updateAccountArchive({
      id: archive.id,
      onlyIfStatus: ['queued', 'running'],
      status: 'failed',
      error: 'The export stopped making progress',
      progress: null
    })
    if (store)
      await deleteArchiveFiles(store, archive.id).catch(() => undefined)
    return failed ?? { ...archive, status: 'failed' }
  }

  const progress = parseProgress(archive.progress)
  if (progress) progress.updatedAt = now()
  const marked = await database.updateAccountArchive({
    id: archive.id,
    onlyIfStatus: ['queued', 'running'],
    // Only one sweep or request wins the requeue of a given cursor.
    onlyIfProgress: archive.progress,
    error: `${REAP_MARKER}${reaps + 1}`,
    ...(progress ? { progress: serializeProgress(progress) } : {})
  })
  if (!marked) return archive

  try {
    await queue.publish({
      id: getHashFromString(`${archive.id}:reap:${reaps + 1}`),
      name: EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { archiveId: archive.id, slice: progress?.slice ?? 0 }
    })
  } catch (error) {
    logger.error({
      message: 'Failed to requeue a stuck account archive export',
      archiveId: archive.id,
      err: toLoggableError(error)
    })
  }
  return marked
}

/** Reaps every stuck export; the periodic sweep runs this beside the expiry. */
export const sweepStuckAccountArchives = async (
  database: Database,
  now: number = Date.now()
): Promise<number> => {
  const candidates = await database.getActiveAccountArchivesCreatedBefore({
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
        err: toLoggableError(error)
      })
    }
  }
  return reaped
}
