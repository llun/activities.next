import type { Database } from '@/lib/database/types'

import { deleteArchiveFiles } from './expiry'
import { type ArchiveObjectStore, getArchiveObjectStore } from './objectStore'

const PURGE_LIMIT = 1000

/** The ids of every export row the account has, whatever its state. */
export const listAccountArchiveIds = async (
  database: Database,
  accountId: string
): Promise<string[]> =>
  (
    await database.getAccountArchivesForAccount({
      accountId,
      limit: PURGE_LIMIT
    })
  ).map((archive) => archive.id)

/** Deletes the files of the given exports (zip and staged parts). */
export const deleteAccountArchiveFiles = async (
  archiveIds: string[],
  store: ArchiveObjectStore | null = getArchiveObjectStore()
) => {
  if (!store) return
  for (const id of archiveIds) await deleteArchiveFiles(store, id)
}

/**
 * Removes everything the account's exports left behind: the files first, then
 * the rows. A failure while deleting files throws before any row is removed, so
 * the caller can retry and the files stay findable.
 */
export const purgeAccountArchives = async ({
  database,
  accountId,
  store = getArchiveObjectStore()
}: {
  database: Database
  accountId: string
  store?: ArchiveObjectStore | null
}) => {
  await deleteAccountArchiveFiles(
    await listAccountArchiveIds(database, accountId),
    store
  )
  await database.deleteAccountArchivesForAccount({ accountId })
}
