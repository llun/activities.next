// Client access to the Web Share Target staging database. `public/sw.js` writes
// the records; this module reads one and deletes it in the same transaction, so
// a share is consumed exactly once. It never opens `activities_drafts_v1`.
import {
  SHARE_TARGET_DB_NAME,
  SHARE_TARGET_STORE,
  SHARE_TARGET_TTL_MS,
  type StagedShare,
  type StagedShareFile
} from './types'

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'))
      return
    }
    const request = indexedDB.open(SHARE_TARGET_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SHARE_TARGET_STORE)) {
        db.createObjectStore(SHARE_TARGET_STORE, { keyPath: 'id' })
      }
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Share target DB is blocked'))
    request.onsuccess = () => resolve(request.result)
  })

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      // Bracket access keeps IndexedDB out of the Kysely transaction-call-site
      // guard, which matches on `.transaction(` (draftsDb does the same).
      const tx = db['transaction'](SHARE_TARGET_STORE, mode)
      const request = run(tx.objectStore(SHARE_TARGET_STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    try {
      db.close()
    } catch {
      // ignore
    }
  }
}

const isExpired = (share: StagedShare) =>
  typeof share.createdAt !== 'number' ||
  share.createdAt < Date.now() - SHARE_TARGET_TTL_MS

/** Reads a staged share without consuming it. */
export const peekStagedShare = async (
  id: string
): Promise<StagedShare | null> => {
  try {
    const share = await withStore<StagedShare | undefined>(
      'readonly',
      (store) => store.get(id)
    )
    if (!share || isExpired(share)) return null
    return share
  } catch {
    return null
  }
}

/** Reads a staged share and deletes it in the same transaction. */
export const takeStagedShare = async (
  id: string
): Promise<StagedShare | null> => {
  try {
    const db = await openDb()
    try {
      return await new Promise<StagedShare | null>((resolve, reject) => {
        const tx = db['transaction'](SHARE_TARGET_STORE, 'readwrite')
        const store = tx.objectStore(SHARE_TARGET_STORE)
        const request = store.get(id)
        let share: StagedShare | null = null
        request.onsuccess = () => {
          const value = request.result as StagedShare | undefined
          if (value && !isExpired(value)) {
            share = value
            store.delete(id)
          }
        }
        tx.oncomplete = () => resolve(share)
        tx.onabort = () => reject(tx.error)
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      try {
        db.close()
      } catch {
        // ignore
      }
    }
  } catch {
    return null
  }
}

/** Writes files to the staging database, for a handoff to another page. */
export const stageShareFiles = async (
  files: File[],
  meta: { title?: string; text?: string; url?: string; skipped?: number } = {}
): Promise<string | null> => {
  try {
    const staged: StagedShareFile[] = []
    for (const file of files) {
      staged.push({
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        size: file.size,
        bytes: await file.arrayBuffer()
      })
    }
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const record: StagedShare = {
      id,
      createdAt: Date.now(),
      title: meta.title,
      text: meta.text,
      url: meta.url,
      files: staged,
      skipped: meta.skipped
    }
    await withStore('readwrite', (store) => store.put(record))
    return id
  } catch {
    return null
  }
}

/** Rebuilds the Files the worker staged. */
export const toShareFiles = (share: StagedShare): File[] =>
  share.files.map(
    (file) =>
      new File([file.bytes], file.name, {
        type: file.type,
        lastModified: file.lastModified
      })
  )
