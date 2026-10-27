import type { Database } from '@/lib/database/types'
import {
  type AccountImportObjectStore,
  getAccountImportObjectStore
} from '@/lib/services/accountImport/objectStore'
import type { AccountImport } from '@/lib/types/domain/accountImport'

// The same bound the export purge uses: an owner cannot accumulate more
// uploaded archives than this without deleting the actors that own them.
const PURGE_LIMIT = 1000

/** Deletes the files of the given imports (the upload under `imports/`). */
export const deleteAccountImportUploads = async (
  accountImports: AccountImport[],
  store: AccountImportObjectStore | null = getAccountImportObjectStore()
) => {
  if (!store) return
  for (const accountImport of accountImports) {
    await store.deleteUpload(accountImport)
  }
}

/**
 * Removes an actor's import uploads before `deleteActorData` removes the rows.
 * The files go first, and before the actor is marked `deleting`: a failure
 * here throws while the deletion is still `scheduled`, so the job retries and
 * the files stay findable by the rows that still name them.
 */
export const purgeActorAccountImports = async ({
  database,
  actorId,
  store = getAccountImportObjectStore()
}: {
  database: Database
  actorId: string
  store?: AccountImportObjectStore | null
}) => {
  if (!store) return
  await deleteAccountImportUploads(
    await database.listAccountImports({ actorId, limit: PURGE_LIMIT }),
    store
  )
}
