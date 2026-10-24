import type { Database } from '@/lib/database/types'
import type { AccountArchive } from '@/lib/types/domain/accountArchive'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import {
  type ArchiveObjectStore,
  getArchiveObjectStore,
  getArchiveStorageKey
} from './objectStore'

const SWEEP_BATCH = 50

/** Deletes everything stored for an export (the zip and any staged parts). */
export const deleteArchiveFiles = async (
  store: ArchiveObjectStore,
  archiveId: string
) => {
  await store.deletePrefix(getArchiveStorageKey(archiveId))
}

/**
 * Deletes the export's file and marks it expired. Safe to run twice: the row
 * only changes while it is still `ready`.
 */
export const expireAccountArchive = async ({
  database,
  archive,
  store = getArchiveObjectStore()
}: {
  database: Database
  archive: AccountArchive
  store?: ArchiveObjectStore | null
}): Promise<AccountArchive | null> => {
  if (store) await deleteArchiveFiles(store, archive.id)
  return database.updateAccountArchive({
    id: archive.id,
    onlyIfStatus: ['ready'],
    status: 'expired',
    storagePath: null,
    progress: null
  })
}

/** Expires the export when its time has passed; returns the row as it now is. */
export const expireArchiveIfDue = async ({
  database,
  archive,
  store,
  now = Date.now
}: {
  database: Database
  archive: AccountArchive
  store?: ArchiveObjectStore | null
  now?: () => number
}): Promise<AccountArchive> => {
  if (
    archive.status !== 'ready' ||
    archive.expiresAt === null ||
    archive.expiresAt > now()
  ) {
    return archive
  }
  const updated = await expireAccountArchive({ database, archive, store })
  return updated ?? { ...archive, status: 'expired', storagePath: null }
}

/**
 * Expires every ready export past its time. The periodic sweep is the only
 * thing that does this under the in-process queue (it cannot delay a job); with
 * a real queue it is the safety net for a delayed expiry that was lost.
 */
export const sweepExpiredAccountArchives = async (
  database: Database,
  now: number = Date.now()
): Promise<number> => {
  const store = getArchiveObjectStore()
  const due = await database.getExpiredAccountArchives({
    now,
    limit: SWEEP_BATCH
  })
  let expired = 0
  for (const archive of due) {
    try {
      await expireAccountArchive({ database, archive, store })
      expired += 1
    } catch (error) {
      logger.error({
        message: 'Failed to expire an account archive',
        archiveId: archive.id,
        err: toLoggableError(error)
      })
    }
  }
  return expired
}
