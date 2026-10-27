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
    accountImport: Pick<AccountImport, 'id' | 'storageToken'>
  ): Promise<RandomAccessSource | null>
  deleteUpload(
    accountImport: Pick<AccountImport, 'id' | 'storageToken'>
  ): Promise<void>
}

const assertImportKey = (key: string) => assertArchiveKey(key)

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
    readonly size: number
  ) {}

  async read(start: number, endInclusive: number): Promise<Buffer> {
    const bytes = await this.store.readRange(this.key, start, endInclusive)
    if (!bytes) throw new Error('Import archive is missing')
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
      const size = await store.size(key)
      return size === null
        ? null
        : new StoreRandomAccessSource(store, key, size)
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
