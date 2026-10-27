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
  await database.updateAccountImport({
    id: accountImport.id,
    onlyIfStatus: ['queued'],
    status: 'failed',
    lastErrorCode: code,
    finishedAt: now
  })
  await objectStore.deleteUpload(accountImport)
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
  if (contentLength !== undefined && contentLength > limit) {
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
      if (bytes > limit) {
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

    await sink.finish()
    const updated = await database.updateAccountImport({
      id: accountImport.id,
      onlyIfStatus: ['queued'],
      uploadedBytes: bytes
    })
    if (!updated) {
      await objectStore.deleteUpload(accountImport)
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
