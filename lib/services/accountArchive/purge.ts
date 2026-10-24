import type { Database } from '@/lib/database/types'
import type { AccountArchive } from '@/lib/types/domain/accountArchive'

import { discardUnfinishedArchive } from './expiry'
import { type ArchiveObjectStore, getArchiveObjectStore } from './objectStore'

const PURGE_LIMIT = 1000

/** Every export row the account has, whatever its state. */
export const listAccountArchives = (
  database: Database,
  accountId: string
): Promise<AccountArchive[]> =>
  database.getAccountArchivesForAccount({ accountId, limit: PURGE_LIMIT })

/** Deletes the files of the given exports (zip, staged parts, open uploads). */
export const deleteAccountArchiveFiles = async (
  archives: AccountArchive[],
  store: ArchiveObjectStore | null = getArchiveObjectStore()
) => {
  if (!store) return
  for (const archive of archives) await discardUnfinishedArchive(store, archive)
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
    await listAccountArchives(database, accountId),
    store
  )
  await database.deleteAccountArchivesForAccount({ accountId })
}
