import { getAccountImportConfig } from '@/lib/config/accountImport'
import type { Database } from '@/lib/database/types'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import {
  type AccountImportOptions,
  accountImportOptionsSchema,
  inspectAccountArchive
} from '@/lib/services/accountImport/phases'
import {
  createInitialImportProgress,
  serializeImportProgress
} from '@/lib/services/accountImport/progress'
import { ZipArchiveError } from '@/lib/services/accountImport/zip/reader'
import type { AccountImport } from '@/lib/types/domain/accountImport'

export type StartAccountImportResult =
  | { type: 'started'; accountImport: AccountImport }
  | {
      type: 'not-found' | 'not-queued' | 'active' | 'too-large' | 'unrecognised'
    }
  | { type: 'storage-unavailable' }

export const startAccountImport = async ({
  database,
  objectStore,
  accountImport,
  options,
  now = Date.now
}: {
  database: Database
  objectStore: AccountImportObjectStore | null
  accountImport: AccountImport
  options: AccountImportOptions
  now?: () => number
}): Promise<StartAccountImportResult> => {
  if (!objectStore) return { type: 'storage-unavailable' }
  if (accountImport.status !== 'queued') return { type: 'not-queued' }
  const active = await database.getActiveAccountImport({
    actorId: accountImport.actorId
  })
  if (active && active.id !== accountImport.id) return { type: 'active' }

  const size = await objectStore.store.size(
    objectStore.getUploadKey(accountImport)
  )
  if (size === null || size === 0) return { type: 'unrecognised' }
  if (size > getAccountImportConfig().maxFileSize) return { type: 'too-large' }

  let inspected
  try {
    inspected = await inspectAccountArchive({ objectStore, accountImport })
  } catch (error) {
    if (error instanceof ZipArchiveError) return { type: 'unrecognised' }
    throw error
  }
  if (!inspected) return { type: 'unrecognised' }

  const progress = {
    ...createInitialImportProgress(),
    sourceActorId: inspected.sourceActorId,
    sourceFollowersUrl: inspected.sourceFollowersUrl,
    selectedOptions: accountImportOptionsSchema.parse(options)
  }
  const startedAt = now()
  const updated = await database.updateAccountImport({
    id: accountImport.id,
    onlyIfStatus: ['queued'],
    status: 'running',
    kind: inspected.kind,
    progress: serializeImportProgress(progress),
    phase: 'inspect',
    cursor: null,
    uploadedBytes: size,
    startedAt
  })
  if (!updated) return { type: 'not-queued' }
  const changed = await database.getAccountImport({
    id: accountImport.id,
    actorId: accountImport.actorId
  })
  return changed
    ? { type: 'started', accountImport: changed }
    : { type: 'not-found' }
}
