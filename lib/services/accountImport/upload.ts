import { getAccountImportConfig } from '@/lib/config/accountImport'
import type { Database } from '@/lib/database/types'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import type { AccountImport } from '@/lib/types/domain/accountImport'

export type AccountImportUploadResult =
  | { type: 'stored'; bytes: number }
  | { type: 'too-large' }
  | { type: 'invalid' }
  | { type: 'not-queued' }
  | { type: 'unavailable' }

const failUpload = async (
  database: Database,
  objectStore: AccountImportObjectStore,
  accountImport: AccountImport,
  code: string,
  now: number
) => {
  const applied = await database.updateAccountImport({
    id: accountImport.id,
    onlyIfStatus: ['queued'],
    status: 'failed',
    lastErrorCode: code,
    finishedAt: now
  })
  // The staged bytes are removed only when this row is still the queued
  // upload they belong to: a row that already left `queued` is running or
  // finished, and its archive is not this attempt's to delete.
  if (applied) {
    await objectStore.deleteUpload(accountImport)
  }
}

/** Streams a request body straight into the configured object store. */
export const uploadAccountImport = async ({
  database,
  objectStore,
  accountImport,
  body,
  contentLength,
  now = Date.now
}: {
  database: Database
  objectStore: AccountImportObjectStore
  accountImport: AccountImport
  body: ReadableStream<Uint8Array> | null
  contentLength?: number
  now?: () => number
}): Promise<AccountImportUploadResult> => {
  const limit = getAccountImportConfig().maxFileSize
  const declaredSize = accountImport.uploadedBytes || undefined
  if (!body) {
    await failUpload(
      database,
      objectStore,
      accountImport,
      'upload_empty',
      now()
    )
    return { type: 'invalid' }
  }
  if (
    (contentLength !== undefined && contentLength > limit) ||
    (declaredSize !== undefined &&
      contentLength !== undefined &&
      contentLength !== declaredSize)
  ) {
    await failUpload(
      database,
      objectStore,
      accountImport,
      'file_too_large',
      now()
    )
    return { type: 'too-large' }
  }

  const key = objectStore.getUploadKey(accountImport)
  const sink = await objectStore.store.openResumableWrite(key, null)
  const reader = body.getReader()
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (
        bytes > limit ||
        (declaredSize !== undefined && bytes > declaredSize)
      ) {
        await reader.cancel()
        await sink.abort()
        await failUpload(
          database,
          objectStore,
          accountImport,
          'file_too_large',
          now()
        )
        return { type: 'too-large' }
      }
      await sink.write(Buffer.from(value))
    }

    if (declaredSize !== undefined && bytes !== declaredSize) {
      await sink.abort()
      await failUpload(
        database,
        objectStore,
        accountImport,
        'file_too_large',
        now()
      )
      return { type: 'too-large' }
    }

    // The row must still be queued immediately before the streamed bytes
    // become the archive key's content: an import that started meanwhile
    // owns that key, and a late upload must never overwrite it. The staged
    // bytes are thrown away instead.
    const current = await database.getAccountImport({
      id: accountImport.id,
      actorId: accountImport.actorId
    })
    if (!current || current.status !== 'queued') {
      await sink.abort()
      return { type: 'not-queued' }
    }
    await sink.finish()
    const updated = await database.updateAccountImport({
      id: accountImport.id,
      onlyIfStatus: ['queued'],
      uploadedBytes: bytes
    })
    if (!updated) {
      // The row left `queued` between the check and the update: the upload
      // is refused, and the archive is left alone for the same reason as
      // above.
      return { type: 'not-queued' }
    }
    return { type: 'stored', bytes }
  } catch {
    await sink.abort().catch(() => undefined)
    await failUpload(
      database,
      objectStore,
      accountImport,
      'upload_failed',
      now()
    )
    return { type: 'unavailable' }
  } finally {
    reader.releaseLock()
    await sink.release().catch(() => undefined)
  }
}
