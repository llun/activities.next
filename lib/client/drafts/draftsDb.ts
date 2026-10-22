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
import { holdsQueue, pausedByReader, retriesOnItsOwn } from './queueConstants'
import {
  DRAFTS_DB_NAME,
  DRAFTS_DB_VERSION,
  type DraftBlobRecord,
  type DraftQueuePause,
  type DraftQueueState,
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

// Send-queue operations. Each is one readwrite transaction, so
// two tabs claiming the same draft are serialized and exactly one wins. Queue
// writes keep `updatedAt` ("content saved at").

/** Whether the sender may claim this queue entry at `now`. */
export const isQueueClaimable = (
  queue: DraftQueueState | undefined,
  now: number
): boolean => {
  if (!queue) return false
  // A `sending` entry is claimable only once its lease ran out (a dead tab).
  if (queue.state === 'sending') return (queue.claim?.until ?? 0) <= now
  return retriesOnItsOwn(queue) && (queue.nextAttemptAt ?? 0) <= now
}

/**
 * Claims a queued draft for `tabId` until `now + leaseMs`, or resolves `null`
 * when the account signed out (epoch), the draft is gone, belongs to another
 * account, or is not claimable (another tab holds a live lease, not due yet).
 */
export const claimQueuedDraft = (
  id: string,
  {
    tabId,
    now,
    leaseMs,
    accountId,
    epoch
  }: {
    tabId: string
    now: number
    leaseMs: number
    accountId: string
    epoch: number
  }
): Promise<DraftRecord | null> =>
  runTx<DraftRecord | null>(
    [DRAFTS_STORE, META_STORE],
    'readwrite',
    (tx, { done, guard }) => {
      done(null)
      const epochRequest = tx.objectStore(META_STORE).get(epochKey(accountId))
      epochRequest.onsuccess = guard(() => {
        const current = (epochRequest.result as EpochRecord | undefined)?.value
        if ((current ?? 0) !== epoch) return
        const drafts = tx.objectStore(DRAFTS_STORE)
        const request = drafts.get(id)
        request.onsuccess = guard(() => {
          const existing = request.result as DraftRecord | undefined
          if (!existing?.queue || existing.accountId !== accountId) return
          if (!isQueueClaimable(existing.queue, now)) return
          if (existing.queue.pauseRequested) {
            // A dead tab's send the reader paused: take it back as paused,
            // never send it again unasked.
            const {
              claim: _claim,
              pauseRequested: _pauseRequested,
              ...queue
            } = existing.queue
            drafts.put({
              ...existing,
              revision: existing.revision + 1,
              queue: pausedByReader(queue)
            })
            return
          }
          const {
            pausedBy: _pausedBy,
            reason: _reason,
            ...queue
          } = existing.queue
          const claimed: DraftRecord = {
            ...existing,
            revision: existing.revision + 1,
            queue: {
              ...queue,
              state: 'sending',
              claim: { tabId, until: now + leaseMs }
            }
          }
          drafts.put(claimed)
          done(claimed)
        })
      })
    }
  )

/**
 * Revision-checked queue write: a stale revision or a missing draft rejects
 * with `DraftConflictError` and changes nothing. Keeps `id` and `updatedAt`.
 */
export const updateQueuedDraft = (
  id: string,
  expectedRevision: number,
  mutate: (record: DraftRecord) => DraftRecord
): Promise<DraftRecord> =>
  runTx<DraftRecord>(
    [DRAFTS_STORE],
    'readwrite',
    (tx, { done, fail, guard }) => {
      const drafts = tx.objectStore(DRAFTS_STORE)
      const request = drafts.get(id)
      request.onsuccess = guard(() => {
        const existing = request.result as DraftRecord | undefined
        if (!existing || existing.revision !== expectedRevision) {
          return fail(new DraftConflictError())
        }
        const updated: DraftRecord = {
          ...mutate(existing),
          id,
          revision: expectedRevision + 1,
          updatedAt: existing.updatedAt
        }
        drafts.put(updated)
        done(updated)
      })
    }
  )

/**
 * Extends the lease while `tabId` still holds it. No revision bump: the lease
 * is not content, and every content writer re-reads the claim or conflicts on
 * revision already.
 */
export const renewClaim = (
  id: string,
  { tabId, until }: { tabId: string; until: number }
): Promise<boolean> =>
  runTx<boolean>([DRAFTS_STORE], 'readwrite', (tx, { done, guard }) => {
    done(false)
    const drafts = tx.objectStore(DRAFTS_STORE)
    const request = drafts.get(id)
    request.onsuccess = guard(() => {
      const existing = request.result as DraftRecord | undefined
      const queue = existing?.queue
      if (!existing || queue?.state !== 'sending') return
      if (queue.claim?.tabId !== tabId) return
      drafts.put({ ...existing, queue: { ...queue, claim: { tabId, until } } })
      done(true)
    })
  })

export const ATTEMPTED_UNQUEUE_MESSAGE =
  'This post may already have been sent. Press Post to retry it as it is, or discard it.'

/**
 * Takes a draft out of the queue for Review/Edit and returns the new record,
 * which the editor seeds from. Refuses with `DraftBusyError` while a send is
 * unresolved (`sending`, even with an expired lease, or `checking`): only the
 * same key may settle it. Keeps `submit`, `attemptedAt` and `lockedMessage`;
 * an attempted draft without one is locked (media `owned: false`).
 */
export const unqueueDraft = (id: string): Promise<DraftRecord | undefined> =>
  runTx<DraftRecord | undefined>(
    [DRAFTS_STORE],
    'readwrite',
    (tx, { done, fail, guard }) => {
      const drafts = tx.objectStore(DRAFTS_STORE)
      const request = drafts.get(id)
      request.onsuccess = guard(() => {
        const existing = request.result as DraftRecord | undefined
        if (!existing?.queue) return done(existing)
        const { state } = existing.queue
        if (state === 'sending' || state === 'checking') {
          return fail(new DraftBusyError())
        }
        const { queue: _queue, ...rest } = existing
        const attempted =
          !!existing.queue.firstAttemptAt ||
          (!!existing.attemptedAt && !!existing.submit)
        // A POST may have landed: reopen locked under the same key, never re-keyed.
        const unqueued: DraftRecord = {
          ...rest,
          ...(attempted && !existing.lockedMessage
            ? {
                lockedMessage: ATTEMPTED_UNQUEUE_MESSAGE,
                attachments: existing.attachments.map((item) => ({
                  ...item,
                  owned: false
                })),
                ...(existing.fitnessFile
                  ? { fitnessFile: { ...existing.fitnessFile, owned: false } }
                  : {})
              }
            : {}),
          revision: existing.revision + 1
        }
        drafts.put(unqueued)
        done(unqueued)
      })
    }
  )

// Rewrites this actor's queue entries in one transaction; returns how many.
const rewriteQueue = (
  actorId: string,
  rewrite: (queue: DraftQueueState) => DraftQueueState | null
): Promise<number> =>
  runTx<number>([DRAFTS_STORE], 'readwrite', (tx, { done, guard }) => {
    const drafts = tx.objectStore(DRAFTS_STORE)
    const request = drafts.index('byActor').getAll(actorId)
    request.onsuccess = guard(() => {
      let count = 0
      for (const record of request.result as DraftRecord[]) {
        const queue = record.queue && rewrite(record.queue)
        if (!queue) continue
        // A `sending` item keeps its revision, as a lease renewal does: the
        // claim owner's revision-checked write must still land, and it reads
        // the change inside that write.
        const revision =
          record.queue?.state === 'sending'
            ? record.revision
            : record.revision + 1
        drafts.put({ ...record, revision, queue })
        count += 1
      }
      done(count)
    })
  })

/**
 * Pause: every item that would retry on its own → `paused(user)`. A `sending`
 * item's request may be on the wire, so it is only marked: a retry it settles
 * into is paused instead.
 */
export const pauseQueue = ({ actorId }: { actorId: string }): Promise<number> =>
  rewriteQueue(actorId, (queue) => {
    // In flight, or held for sign-in or a profile switch (which the next load
    // lifts): only marked, so the reader's pause outlasts that.
    if (queue.state === 'sending' || holdsQueue(queue)) {
      return queue.pauseRequested ? null : { ...queue, pauseRequested: true }
    }
    return retriesOnItsOwn(queue) ? pausedByReader(queue) : null
  })

/** Resume matching pauses to `checking` once a POST was made, else `waiting`. */
export const resumeQueue = ({
  actorId,
  pausedBy
}: {
  actorId: string
  pausedBy: DraftQueuePause[]
}): Promise<number> =>
  rewriteQueue(actorId, (queue) => {
    // Resume takes the reader's mark off an in-flight or held item.
    if (queue.pauseRequested && pausedBy.includes('user')) {
      const { pauseRequested: _pauseRequested, ...rest } = queue
      return rest
    }
    if (queue.state !== 'paused' || !queue.pausedBy) return null
    if (!pausedBy.includes(queue.pausedBy)) return null
    const {
      pausedBy: _pausedBy,
      reason: _reason,
      nextAttemptAt: _nextAttemptAt,
      retries: _retries,
      pauseRequested,
      ...rest
    } = queue
    const back: DraftQueueState = {
      ...rest,
      state: rest.firstAttemptAt ? 'checking' : 'waiting'
    }
    // Lifting a sign-in or profile-switch hold keeps the reader's own Pause.
    return pauseRequested ? pausedByReader(back) : back
  })
