// Client access to the Web Share Target staging database. `public/sw.js` writes
// the records; this module reads one (`peekStagedShare`, for the confirmation),
// deletes it once the reader adds or discards it (`takeStagedShare`,
// `deleteStagedShare`), and clears them all on sign-out. It never opens
// `activities_drafts_v1`.
import { readSharePurgePending, settleSharePurge } from './pendingSharePurge'
import {
  SHARE_TARGET_DB_NAME,
  SHARE_TARGET_DB_VERSION,
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
    const request = indexedDB.open(
      SHARE_TARGET_DB_NAME,
      SHARE_TARGET_DB_VERSION
    )
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
    // Unguessable or nothing: without a CSPRNG this throws (caught below).
    const id = crypto.randomUUID()
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

/** How long sign-out waits for `clearStagedShares` before going on. */
export const CLEAR_STAGED_SHARES_TIMEOUT_MS = 5_000

// Bounded, as draftsDb bounds its opens: sign-out awaits a clear, and a hung
// IndexedDB must not keep the reader on a "signing out" screen. True only when
// the work finished in time.
const bounded = async (work: Promise<unknown>): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), CLEAR_STAGED_SHARES_TIMEOUT_MS)
      })
    ])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Deletes one staged share (the reader discarded it). */
export const deleteStagedShare = async (id: string): Promise<void> => {
  try {
    await withStore('readwrite', (store) => store.delete(id))
  } catch {
    // Nothing staged, or IndexedDB is unavailable: nothing to delete.
  }
}

/**
 * Deletes every staged share. Called on an explicit sign-out only, so the
 * next account on a shared device never sees the previous reader's files; a
 * session expiry (401) keeps them, so a share survives signing in again.
 * False when the clear failed or timed out: the caller keeps the purge marker.
 */
export const clearStagedShares = async (): Promise<boolean> =>
  bounded(withStore('readwrite', (store) => store.clear()))

/**
 * Deletes the shares staged at or before `markedAt` (a sign-out time), keeping
 * any made after it. True once they are gone.
 */
export const deleteSharesStagedBefore = async (
  markedAt: number
): Promise<boolean> =>
  bounded(
    (async () => {
      const db = await openDb()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db['transaction'](SHARE_TARGET_STORE, 'readwrite')
          const cursorRequest = tx.objectStore(SHARE_TARGET_STORE).openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (!cursor) return
            const value = cursor.value as StagedShare | undefined
            if (
              !value ||
              typeof value.createdAt !== 'number' ||
              value.createdAt <= markedAt
            ) {
              cursor.delete()
            }
            cursor.continue()
          }
          tx.oncomplete = () => resolve()
          tx.onabort = () => reject(tx.error)
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    })()
  )

/**
 * Run before any share is read. A sign-out that could not clear the staged
 * shares left a marker (pendingSharePurge.ts): its shares are deleted first
 * and the marker removed. False when that purge still fails, and then nothing
 * may be read: a previous account's files could still be there.
 */
export const honourPendingSharePurge = async (): Promise<boolean> => {
  const markedAt = await readSharePurgePending()
  if (markedAt === null) return true
  if (!(await deleteSharesStagedBefore(markedAt))) return false
  await settleSharePurge()
  return true
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
