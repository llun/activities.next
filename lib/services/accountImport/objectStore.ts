import {
  type ArchiveObjectStore,
  assertArchiveKey,
  getArchiveObjectStore
} from '@/lib/services/accountArchive/objectStore'
import type { RandomAccessSource } from '@/lib/services/accountImport/zip/source'
import type { AccountImport } from '@/lib/types/domain/accountImport'

export interface AccountImportObjectStore {
  readonly store: ArchiveObjectStore
  getUploadKey(
    accountImport: Pick<AccountImport, 'id' | 'storageToken'>
  ): string
  openSource(
    accountImport: Pick<AccountImport, 'id' | 'storageToken'> &
      Partial<Pick<AccountImport, 'archiveETag' | 'uploadedBytes'>>
  ): Promise<RandomAccessSource | null>
  deleteUpload(
    accountImport: Pick<AccountImport, 'id' | 'storageToken'>
  ): Promise<void>
}

const assertImportKey = (key: string) => assertArchiveKey(key)

export class AccountImportArchiveChangedError extends Error {
  constructor() {
    super('Account import archive changed')
    this.name = 'AccountImportArchiveChangedError'
  }
}

const isPreconditionFailed = (error: unknown) => {
  const e = error as {
    name?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    e?.name === 'PreconditionFailed' || e?.$metadata?.httpStatusCode === 412
  )
}

export const getAccountImportUploadKey = (
  accountImport: Pick<AccountImport, 'id' | 'storageToken'>
) =>
  assertImportKey(
    `imports/${accountImport.id}/${accountImport.storageToken}/upload.zip`
  )

class StoreRandomAccessSource implements RandomAccessSource {
  constructor(
    private readonly store: ArchiveObjectStore,
    private readonly key: string,
    readonly size: number,
    private readonly etag: string | null
  ) {}

  async read(start: number, endInclusive: number): Promise<Buffer> {
    let bytes: Buffer | null
    try {
      bytes = await this.store.readRange(this.key, start, endInclusive, {
        ...(this.etag ? { ifMatch: this.etag } : null),
        expectedSize: this.size
      })
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw new AccountImportArchiveChangedError()
      }
      throw error
    }
    if (!bytes || bytes.length !== endInclusive - start + 1) {
      throw new AccountImportArchiveChangedError()
    }
    return bytes
  }
}

export const createAccountImportObjectStore = (
  store: ArchiveObjectStore | null
): AccountImportObjectStore | null => {
  if (!store) return null
  return {
    store,
    getUploadKey: getAccountImportUploadKey,
    async openSource(accountImport) {
      const key = getAccountImportUploadKey(accountImport)
      const metadata = await store.getMetadata(key)
      if (!metadata) throw new AccountImportArchiveChangedError()
      if (
        accountImport.uploadedBytes !== undefined &&
        metadata.size !== accountImport.uploadedBytes
      ) {
        throw new AccountImportArchiveChangedError()
      }
      return new StoreRandomAccessSource(
        store,
        key,
        metadata.size,
        accountImport.archiveETag ?? null
      )
    },
    async deleteUpload(accountImport) {
      await store.deletePrefix(
        `imports/${accountImport.id}/${accountImport.storageToken}`
      )
    }
  }
}

export const getAccountImportObjectStore = () =>
  createAccountImportObjectStore(getArchiveObjectStore())
