// Raw IndexedDB for on-device drafts, no React. This database is separate from
// `activities_offline_v1` on purpose: `clearAllOfflineData()` and the cached
// actors' LRU eviction never open it, and a draft survives a 401. It has no
// `deleteDatabase` anywhere: a failed open reports `DraftsUnavailableError`,
// it never wipes what a user typed.
//
// Every promise settles on `tx.oncomplete` or `tx.onabort`, never on a
// request's `onsuccess`, so a resolved write is a committed write.
import {
  DraftBusyError,
  DraftConflictError,
  DraftQuotaError,
  DraftSignedOutError,
  DraftsUnavailableError
} from './errors'
import {
  DRAFTS_DB_NAME,
  DRAFTS_DB_VERSION,
  type DraftBlobRecord,
  type DraftQueuePause,
  type DraftRecord
} from './types'

export {
  DraftBusyError,
  DraftConflictError,
  DraftQuotaError,
  DraftSignedOutError,
  DraftsUnavailableError
} from './errors'

/** An open that has not finished by now is reported as unavailable. */
export const DRAFTS_OPEN_TIMEOUT_MS = 5_000

const DRAFTS_STORE = 'drafts'
const BLOBS_STORE = 'blobs'
const META_STORE = 'meta'

let customFactory: IDBFactory | null = null
let cachedDb: IDBDatabase | null = null
let openPromise: Promise<IDBDatabase> | null = null

const closeCachedDb = () => {
  const db = cachedDb
  cachedDb = null
  try {
    db?.close()
  } catch {
    // already closed
  }
}

/** Tests give every case a fresh factory (fake-indexeddb). */
export const setDraftsIndexedDBFactory = (factory: IDBFactory | null) => {
  customFactory = factory
  openPromise = null
  closeCachedDb()
}

/** Closes the cached connection; the next call opens again. */
export const resetDraftsDbForTesting = () => {
  openPromise = null
  closeCachedDb()
}

const getFactory = (): IDBFactory | null => {
  if (customFactory) return customFactory
  return typeof indexedDB !== 'undefined' ? indexedDB : null
}

const ensureIndex = (
  store: IDBObjectStore,
  name: string,
  keyPath: string
): void => {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false })
  }
}

// Creates only what is missing. A later version adds stores or indexes and
// never drops or clears one.
const upgrade = (db: IDBDatabase, tx: IDBTransaction) => {
  const drafts = db.objectStoreNames.contains(DRAFTS_STORE)
    ? tx.objectStore(DRAFTS_STORE)
    : db.createObjectStore(DRAFTS_STORE, { keyPath: 'id' })
  ensureIndex(drafts, 'byActor', 'actorId')
  ensureIndex(drafts, 'byAccount', 'accountId')

  const blobs = db.objectStoreNames.contains(BLOBS_STORE)
    ? tx.objectStore(BLOBS_STORE)
    : db.createObjectStore(BLOBS_STORE, { keyPath: 'id' })
  ensureIndex(blobs, 'byDraft', 'draftId')
  ensureIndex(blobs, 'byAccount', 'accountId')

  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE, { keyPath: 'key' })
  }
}

const openDb = (): Promise<IDBDatabase> => {
  if (cachedDb) return Promise.resolve(cachedDb)
  if (openPromise) return openPromise
  const factory = getFactory()
  if (!factory) {
    return Promise.reject(new DraftsUnavailableError('IndexedDB is missing'))
  }

  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const fail = (message: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new DraftsUnavailableError(message))
    }
    const timer = setTimeout(
      () => fail('Opening drafts storage timed out'),
      DRAFTS_OPEN_TIMEOUT_MS
    )

    let request: IDBOpenDBRequest
    try {
      request = factory.open(DRAFTS_DB_NAME, DRAFTS_DB_VERSION)
    } catch {
      fail('Opening drafts storage failed')
      return
    }
    request.onupgradeneeded = () => {
      if (request.transaction) upgrade(request.result, request.transaction)
    }
    request.onsuccess = () => {
      const db = request.result
      if (settled) {
        // Timed out or blocked earlier: don't keep a connection nobody holds.
        db.close()
        return
      }
      settled = true
      clearTimeout(timer)
      const drop = () => {
        db.close()
        if (cachedDb === db) cachedDb = null
      }
      db.onversionchange = drop
      db.onclose = () => {
        if (cachedDb === db) cachedDb = null
      }
      cachedDb = db
      resolve(db)
    }
    request.onerror = () => fail('Opening drafts storage failed')
    request.onblocked = () => fail('Opening drafts storage was blocked')
  })

  const tracked = attempt.finally(() => {
    if (openPromise === tracked) openPromise = null
  })
  openPromise = tracked
  return tracked
}

const mapError = (error: unknown): Error => {
  if (
    error instanceof DraftsUnavailableError ||
    error instanceof DraftQuotaError ||
    error instanceof DraftBusyError ||
    error instanceof DraftConflictError ||
    error instanceof DraftSignedOutError
  ) {
    return error
  }
  if ((error as { name?: string } | null)?.name === 'QuotaExceededError') {
    return new DraftQuotaError()
  }
  return new DraftsUnavailableError(
    error instanceof Error ? error.message : 'Drafts storage failed'
  )
}

interface TxControl<T> {
  /** The value the promise resolves with once the transaction commits. */
  done: (value: T) => void
  /** Aborts the transaction; the promise rejects with `error`. */
  fail: (error: Error) => void
  /** Wraps a request callback so a throw aborts instead of escaping. */
  guard: (fn: () => void) => () => void
}

const runTx = async <T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, control: TxControl<T>) => void
): Promise<T> => {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    let result: T
    let failure: Error | undefined
    let tx: IDBTransaction
    try {
      // Bracket access keeps IndexedDB out of the Kysely transaction-call-site
      // guard, which matches on `.transaction(` (offlineDb does the same).
      tx = db['transaction'](storeNames, mode)
    } catch (error) {
      // A closed connection: drop it so the next call opens again.
      closeCachedDb()
      reject(mapError(error))
      return
    }
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure ?? mapError(tx.error))
    const fail = (error: Error) => {
      failure = error
      try {
        tx.abort()
      } catch {
        // already finished
      }
    }
    const control: TxControl<T> = {
      done: (value) => {
        result = value
      },
      fail,
      guard: (fn) => () => {
        try {
          fn()
        } catch (error) {
          fail(mapError(error))
        }
      }
    }
    control.guard(() => work(tx, control))()
  })
}

const epochKey = (accountId: string) => `epoch:${accountId}`

interface EpochRecord {
  key: string
  value: number
}

export const getAccountEpoch = (accountId: string): Promise<number> =>
  runTx<number>([META_STORE], 'readonly', (tx, { done, guard }) => {
    const request = tx.objectStore(META_STORE).get(epochKey(accountId))
    request.onsuccess = guard(() => {
      done((request.result as EpochRecord | undefined)?.value ?? 0)
    })
  })

export const listDrafts = async ({
  actorId
}: {
  actorId: string
}): Promise<DraftRecord[]> => {
  const drafts = await runTx<DraftRecord[]>(
    [DRAFTS_STORE],
    'readonly',
    (tx, { done, guard }) => {
      const request = tx
        .objectStore(DRAFTS_STORE)
        .index('byActor')
        .getAll(actorId)
      request.onsuccess = guard(() => done(request.result as DraftRecord[]))
    }
  )
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt)
}

export const getDraft = (id: string): Promise<DraftRecord | undefined> =>
  runTx<DraftRecord | undefined>(
    [DRAFTS_STORE],
    'readonly',
    (tx, { done, guard }) => {
      const request = tx.objectStore(DRAFTS_STORE).get(id)
      request.onsuccess = guard(() =>
        done(request.result as DraftRecord | undefined)
      )
    }
  )

export const countDrafts = (
  scope: { actorId: string } | { accountId: string }
): Promise<number> =>
  runTx<number>([DRAFTS_STORE], 'readonly', (tx, { done, guard }) => {
    const store = tx.objectStore(DRAFTS_STORE)
    const request =
      'actorId' in scope
        ? store.index('byActor').count(scope.actorId)
        : store.index('byAccount').count(scope.accountId)
    request.onsuccess = guard(() => done(request.result))
  })

/**
 * One transaction: the epoch must still match (else the account signed out),
 * and the stored revision must equal `expectedRevision` (else another tab saved
 * or deleted this draft). A missing record with `expectedRevision > 0` is a
 * conflict too, so a draft deleted elsewhere is never resurrected.
 */
export const saveDraft = (
  record: DraftRecord,
  { expectedRevision, epoch }: { expectedRevision: number; epoch: number }
): Promise<DraftRecord> =>
  runTx<DraftRecord>(
    [DRAFTS_STORE, META_STORE],
    'readwrite',
    (tx, { done, fail, guard }) => {
      const epochRequest = tx
        .objectStore(META_STORE)
        .get(epochKey(record.accountId))
      epochRequest.onsuccess = guard(() => {
        const current = (epochRequest.result as EpochRecord | undefined)?.value
        if ((current ?? 0) !== epoch) return fail(new DraftSignedOutError())
        const existingRequest = tx.objectStore(DRAFTS_STORE).get(record.id)
        existingRequest.onsuccess = guard(() => {
          const existing = existingRequest.result as DraftRecord | undefined
          if ((existing?.revision ?? 0) !== expectedRevision) {
            return fail(new DraftConflictError())
          }
          const saved: DraftRecord = {
            ...record,
            revision: expectedRevision + 1,
            updatedAt: Date.now()
          }
          tx.objectStore(DRAFTS_STORE).put(saved)
          done(saved)
        })
      })
    }
  )

export const putDraftBlob = (
  blob: Omit<DraftBlobRecord, 'accountId'>,
  { accountId, epoch }: { accountId: string; epoch: number }
): Promise<void> =>
  runTx<void>([BLOBS_STORE, META_STORE], 'readwrite', (tx, { fail, guard }) => {
    const epochRequest = tx.objectStore(META_STORE).get(epochKey(accountId))
    epochRequest.onsuccess = guard(() => {
      const current = (epochRequest.result as EpochRecord | undefined)?.value
      if ((current ?? 0) !== epoch) return fail(new DraftSignedOutError())
      tx.objectStore(BLOBS_STORE).put({ ...blob, accountId })
    })
  })

export const getDraftBlob = (
  id: string
): Promise<DraftBlobRecord | undefined> =>
  runTx<DraftBlobRecord | undefined>(
    [BLOBS_STORE],
    'readonly',
    (tx, { done, guard }) => {
      const request = tx.objectStore(BLOBS_STORE).get(id)
      request.onsuccess = guard(() =>
        done(request.result as DraftBlobRecord | undefined)
      )
    }
  )

export const deleteDraftBlob = (id: string): Promise<void> =>
  runTx<void>([BLOBS_STORE], 'readwrite', (tx) => {
    tx.objectStore(BLOBS_STORE).delete(id)
  })

/** The draft plus its blobs, in one transaction. Never touches media. */
export const deleteDraft = (id: string): Promise<void> =>
  runTx<void>([DRAFTS_STORE, BLOBS_STORE], 'readwrite', (tx, { guard }) => {
    tx.objectStore(DRAFTS_STORE).delete(id)
    const blobs = tx.objectStore(BLOBS_STORE)
    const keys = blobs.index('byDraft').getAllKeys(id)
    keys.onsuccess = guard(() => {
      for (const key of keys.result) blobs.delete(key)
    })
  })

/**
 * One transaction: reads the draft, checks `expectedRevision`, deletes it and
 * its blobs, and returns the record that was actually deleted. A missing draft
 * resolves `undefined` (nothing deleted); a different revision rejects with
 * `DraftConflictError`. Media cleanup must use only the returned record, never
 * a stale snapshot.
 */
export const deleteDraftIfRevision = (
  id: string,
  expectedRevision: number
): Promise<DraftRecord | undefined> =>
  runTx<DraftRecord | undefined>(
    [DRAFTS_STORE, BLOBS_STORE],
    'readwrite',
    (tx, { done, fail, guard }) => {
      const drafts = tx.objectStore(DRAFTS_STORE)
      const request = drafts.get(id)
      request.onsuccess = guard(() => {
        const existing = request.result as DraftRecord | undefined
        if (!existing) return
        if (existing.revision !== expectedRevision) {
          return fail(new DraftConflictError())
        }
        drafts.delete(id)
        const blobs = tx.objectStore(BLOBS_STORE)
        const keys = blobs.index('byDraft').getAllKeys(id)
        keys.onsuccess = guard(() => {
          for (const key of keys.result) blobs.delete(key)
        })
        done(existing)
      })
    }
  )

/**
 * Sign-out: bumps the account's epoch and deletes its drafts and blobs in one
 * transaction. A tab that still holds the old epoch has its next write abort
 * inside its own transaction, so a debounced save can't land afterwards.
 * Returns how many drafts were deleted.
 */
export const deleteAccountDrafts = (accountId: string): Promise<number> =>
  runTx<number>(
    [DRAFTS_STORE, BLOBS_STORE, META_STORE],
    'readwrite',
    (tx, { done, guard }) => {
      const meta = tx.objectStore(META_STORE)
      const drafts = tx.objectStore(DRAFTS_STORE)
      const blobs = tx.objectStore(BLOBS_STORE)

      const epochRequest = meta.get(epochKey(accountId))
      epochRequest.onsuccess = guard(() => {
        const current =
          (epochRequest.result as EpochRecord | undefined)?.value ?? 0
        meta.put({ key: epochKey(accountId), value: current + 1 })
      })

      const draftKeys = drafts.index('byAccount').getAllKeys(accountId)
      draftKeys.onsuccess = guard(() => {
        for (const key of draftKeys.result) drafts.delete(key)
        done(draftKeys.result.length)
      })

      const blobKeys = blobs.index('byAccount').getAllKeys(accountId)
      blobKeys.onsuccess = guard(() => {
        for (const key of blobKeys.result) blobs.delete(key)
      })
    }
  )

// Send-queue operations (plan §4.1). Signatures are final; the bodies land
// with the sender.
const notImplemented = (): never => {
  throw new DraftsUnavailableError('not implemented')
}

export const claimQueuedDraft = async (
  _id: string,
  _options: {
    tabId: string
    now: number
    leaseMs: number
    accountId: string
    epoch: number
  }
): Promise<DraftRecord | null> => notImplemented()

export const updateQueuedDraft = async (
  _id: string,
  _expectedRevision: number,
  _mutate: (record: DraftRecord) => DraftRecord
): Promise<DraftRecord> => notImplemented()

export const renewClaim = async (
  _id: string,
  _options: { tabId: string; until: number }
): Promise<boolean> => notImplemented()

export const unqueueDraft = async (
  _id: string,
  _now: number
): Promise<DraftRecord | undefined> => notImplemented()

export const pauseQueue = async (_options: {
  actorId: string
}): Promise<number> => notImplemented()

export const resumeQueue = async (_options: {
  actorId: string
  pausedBy: DraftQueuePause[]
}): Promise<number> => notImplemented()
