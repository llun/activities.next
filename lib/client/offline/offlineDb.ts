import type { Status } from '@/lib/types/domain/status'
import type { TimelineParentPreview } from '@/lib/types/domain/timeline'

import { trimSegmentsToMax } from './mergeTimelineSegments'
import {
  ActiveOfflineSessionMeta,
  ClientBootstrapSnapshot,
  HydratedOfflineTimeline,
  HydratedTimelineSegment,
  MAX_CACHED_ACTORS,
  MAX_CACHED_STATUSES_PER_TIMELINE,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  PersistedStatusRecord,
  PersistedTimelineSegment,
  PersistedTimelineState,
  ScrollAnchorState,
  SetActiveOfflineSessionParams
} from './types'

interface InMemoryStorage {
  meta: Map<string, ActiveOfflineSessionMeta | Record<string, unknown>>
  bootstrap: Map<string, ClientBootstrapSnapshot>
  statuses: Map<string, PersistedStatusRecord>
  timelines: Map<string, PersistedTimelineState>
}

const memoryStorage: InMemoryStorage = {
  meta: new Map(),
  bootstrap: new Map(),
  statuses: new Map(),
  timelines: new Map()
}

let customFactory: IDBFactory | null = null
let cachedDb: IDBDatabase | null = null
let openDbPromise: Promise<IDBDatabase | null> | null = null
let forceMemoryOnly = false

export const setIndexedDBFactory = (factory: IDBFactory | null) => {
  customFactory = factory
  openDbPromise = null
  if (cachedDb) {
    try {
      cachedDb.close()
    } catch {
      // ignore
    }
    cachedDb = null
  }
}

export const setForceMemoryOnly = (val: boolean) => {
  forceMemoryOnly = val
}

const getFactory = (): IDBFactory | null => {
  if (forceMemoryOnly) return null
  if (customFactory) return customFactory
  if (typeof indexedDB !== 'undefined') return indexedDB
  if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB
  if (typeof self !== 'undefined' && self.indexedDB) return self.indexedDB
  return null
}

const promisifyRequest = <T>(req: IDBRequest<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const waitForTransaction = (tx: IDBTransaction): Promise<void> => {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'))
  })
}

const createIdbTx = (
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode
): IDBTransaction => db['transaction'](storeNames, mode)

const REQUIRED_STORES = ['meta', 'bootstrap', 'statuses', 'timelines'] as const

const setupUpgrade = (req: IDBOpenDBRequest) => {
  req.onupgradeneeded = (_event) => {
    const db = req.result
    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'key' })
    }
    if (!db.objectStoreNames.contains('bootstrap')) {
      db.createObjectStore('bootstrap', { keyPath: 'actorId' })
    }
    if (!db.objectStoreNames.contains('statuses')) {
      const statusStore = db.createObjectStore('statuses', {
        keyPath: ['actorId', 'statusId']
      })
      statusStore.createIndex('byActor', 'actorId', { unique: false })
    }
    if (!db.objectStoreNames.contains('timelines')) {
      const timelineStore = db.createObjectStore('timelines', {
        keyPath: ['actorId', 'timeline', 'filterKey']
      })
      timelineStore.createIndex('byActor', 'actorId', { unique: false })
    }
  }
}

const tryOpenDb = (
  factory: IDBFactory,
  isRetry = false
): Promise<IDBDatabase | null> => {
  return new Promise((resolve) => {
    try {
      const req = factory.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
      setupUpgrade(req)

      req.onsuccess = () => {
        const db = req.result
        const hasAllStores = REQUIRED_STORES.every((store) =>
          db.objectStoreNames.contains(store)
        )

        if (!hasAllStores) {
          try {
            db.close()
          } catch {
            // ignore
          }
          if (!isRetry && typeof factory.deleteDatabase === 'function') {
            try {
              const delReq = factory.deleteDatabase(OFFLINE_DB_NAME)
              delReq.onsuccess = () => {
                resolve(tryOpenDb(factory, true))
              }
              delReq.onerror = () => {
                resolve(null)
              }
              delReq.onblocked = () => {
                resolve(null)
              }
            } catch {
              resolve(null)
            }
            return
          }
          resolve(null)
          return
        }

        cachedDb = db
        cachedDb.onversionchange = () => {
          try {
            cachedDb?.close()
          } catch {
            // ignore
          }
          cachedDb = null
          openDbPromise = null
        }
        resolve(cachedDb)
      }

      req.onerror = () => {
        resolve(null)
      }

      req.onblocked = () => {
        resolve(null)
      }
    } catch {
      resolve(null)
    }
  })
}

const openDb = async (): Promise<IDBDatabase | null> => {
  const factory = getFactory()
  if (!factory) return null
  if (cachedDb) return cachedDb
  if (openDbPromise) return openDbPromise

  openDbPromise = (async () => {
    try {
      return await tryOpenDb(factory, false)
    } finally {
      openDbPromise = null
    }
  })()

  return openDbPromise
}

export const getActiveOfflineSession =
  async (): Promise<ActiveOfflineSessionMeta | null> => {
    try {
      const db = await openDb()
      if (db) {
        try {
          const tx = createIdbTx(db, 'meta', 'readonly')
          const store = tx.objectStore('meta')
          const res = await promisifyRequest(store.get('activeSession'))
          if (res) {
            return res as ActiveOfflineSessionMeta
          }
        } catch {
          // fall through to memoryStorage
        }
      }
      const mem = memoryStorage.meta.get('activeSession')
      return (mem as ActiveOfflineSessionMeta) || null
    } catch {
      return null
    }
  }

export const setActiveOfflineSession = async (
  meta: SetActiveOfflineSessionParams
): Promise<void> => {
  try {
    let accountId = meta.accountId
    if (!accountId) {
      const existing = await getActiveOfflineSession()
      accountId = existing?.accountId ?? ''
    }
    const record: ActiveOfflineSessionMeta = {
      key: 'activeSession',
      accountId,
      actorId: meta.actorId,
      updatedAt: meta.updatedAt ?? Date.now()
    }
    memoryStorage.meta.set('activeSession', record)

    const db = await openDb()
    if (db) {
      try {
        const tx = createIdbTx(db, 'meta', 'readwrite')
        const done = waitForTransaction(tx)
        const store = tx.objectStore('meta')
        store.put(record)
        await done
      } catch {
        // memory already updated
      }
    }
  } catch {
    // safe ignore
  }
}

export const getClientBootstrapSnapshot = async (
  actorId: string
): Promise<ClientBootstrapSnapshot | null> => {
  try {
    const db = await openDb()
    if (db) {
      try {
        const tx = createIdbTx(db, 'bootstrap', 'readonly')
        const store = tx.objectStore('bootstrap')
        const res = await promisifyRequest(store.get(actorId))
        if (res) {
          return res as ClientBootstrapSnapshot
        }
      } catch {
        // fall through to memoryStorage
      }
    }
    return memoryStorage.bootstrap.get(actorId) || null
  } catch {
    return null
  }
}

export const saveClientBootstrapSnapshot = async (
  snapshot: ClientBootstrapSnapshot
): Promise<void> => {
  try {
    memoryStorage.bootstrap.set(snapshot.actorId, snapshot)
    await setActiveOfflineSession({
      accountId: snapshot.accountId,
      actorId: snapshot.actorId,
      updatedAt: snapshot.savedAt
    })

    const db = await openDb()
    if (db) {
      try {
        const tx = createIdbTx(db, 'bootstrap', 'readwrite')
        const done = waitForTransaction(tx)
        const store = tx.objectStore('bootstrap')
        store.put(snapshot)
        await done
      } catch {
        // memory already updated
      }
    }

    // LRU eviction for actors beyond MAX_CACHED_ACTORS (3)
    let allSnapshots: ClientBootstrapSnapshot[] = []
    if (db) {
      try {
        const tx = createIdbTx(db, 'bootstrap', 'readonly')
        const store = tx.objectStore('bootstrap')
        allSnapshots = (await promisifyRequest(
          store.getAll()
        )) as ClientBootstrapSnapshot[]
      } catch {
        allSnapshots = Array.from(memoryStorage.bootstrap.values())
      }
    } else {
      allSnapshots = Array.from(memoryStorage.bootstrap.values())
    }

    allSnapshots.sort((a, b) => b.savedAt - a.savedAt)
    if (allSnapshots.length > MAX_CACHED_ACTORS) {
      const toEvict = allSnapshots.slice(MAX_CACHED_ACTORS)
      for (const actor of toEvict) {
        await clearActorOfflineData(actor.actorId)
      }
    }
  } catch {
    // safe ignore
  }
}

export const getOfflineTimeline = async (params: {
  actorId: string
  timeline?: string
  filterKey?: string
}): Promise<HydratedOfflineTimeline | null> => {
  try {
    const timeline = params.timeline || 'home'
    const filterKey = params.filterKey || 'all'

    const db = await openDb()
    let persisted: PersistedTimelineState | null = null

    if (db) {
      try {
        const tx = createIdbTx(db, 'timelines', 'readonly')
        const store = tx.objectStore('timelines')
        const res = await promisifyRequest(
          store.get([params.actorId, timeline, filterKey])
        )
        if (res) {
          persisted = res as PersistedTimelineState
        }
      } catch {
        // fall through to memory
      }
    }

    if (!persisted) {
      const memKey = `${params.actorId}:::${timeline}:::${filterKey}`
      persisted = memoryStorage.timelines.get(memKey) || null
    }

    if (!persisted) {
      return null
    }

    const neededStatusIds = Array.from(
      new Set(persisted.segments.flatMap((s) => s.statusIds))
    )
    const statusMap = new Map<string, Status>()

    if (db && neededStatusIds.length > 0) {
      try {
        const tx = createIdbTx(db, 'statuses', 'readonly')
        const store = tx.objectStore('statuses')
        const promises = neededStatusIds.map(async (id) => {
          const rec = (await promisifyRequest(
            store.get([params.actorId, id])
          )) as PersistedStatusRecord | undefined
          if (rec?.status) {
            statusMap.set(id, rec.status)
          }
        })
        await Promise.all(promises)
      } catch {
        // fall through to memory
      }
    }

    const hydratedSegments: HydratedTimelineSegment[] = []
    for (const seg of persisted.segments) {
      const statuses: Status[] = []
      for (const id of seg.statusIds) {
        const st =
          statusMap.get(id) ||
          memoryStorage.statuses.get(`${params.actorId}:::${id}`)?.status
        if (st) {
          statuses.push(st)
        }
      }
      hydratedSegments.push({
        statuses,
        nextMaxStatusId: seg.nextMaxStatusId,
        prevMinStatusId: seg.prevMinStatusId
      })
    }

    const allStatuses = hydratedSegments.flatMap((s) => s.statuses)
    const lastSeg = hydratedSegments[hydratedSegments.length - 1]
    const nextMaxStatusId = lastSeg ? lastSeg.nextMaxStatusId : null

    return {
      actorId: persisted.actorId,
      timeline: persisted.timeline,
      filterKey: persisted.filterKey,
      segments: hydratedSegments,
      statuses: allStatuses,
      ancestorsById: persisted.ancestorsById || {},
      nextMaxStatusId,
      lastRefreshedAt: persisted.lastRefreshedAt,
      // The cache is capped, so an anchor saved deeper than it keeps (or one
      // whose status is gone) cannot be restored; drop it instead of letting
      // the page jump to it later. Also drop an anchor on the very first post
      // with offsetTop > 80, which was recorded while the reader was still at
      // the top of the timeline above or inside the composer.
      scrollAnchor:
        persisted.scrollAnchor &&
        allStatuses.some((s) => s.id === persisted.scrollAnchor?.statusId) &&
        !(
          allStatuses[0]?.id === persisted.scrollAnchor.statusId &&
          persisted.scrollAnchor.offsetTop > 80
        )
          ? persisted.scrollAnchor
          : null
    }
  } catch {
    return null
  }
}

export const saveOfflineTimeline = async (params: {
  actorId: string
  timeline?: string
  filterKey?: string
  segments: HydratedTimelineSegment[]
  ancestorsById?: Record<string, TimelineParentPreview>
  lastRefreshedAt?: number
  scrollAnchor?: ScrollAnchorState | null
}): Promise<void> => {
  try {
    const timeline = params.timeline || 'home'
    const filterKey = params.filterKey || 'all'
    const lastRefreshedAt = params.lastRefreshedAt ?? Date.now()
    const ancestorsById = params.ancestorsById || {}
    const scrollAnchor = params.scrollAnchor ?? null

    const trimmedSegments = trimSegmentsToMax(
      params.segments,
      MAX_CACHED_STATUSES_PER_TIMELINE
    )

    const statusRecords: PersistedStatusRecord[] = []
    for (const seg of trimmedSegments) {
      for (const st of seg.statuses) {
        statusRecords.push({
          actorId: params.actorId,
          statusId: st.id,
          status: st,
          updatedAt: lastRefreshedAt
        })
      }
    }

    // Save statuses to memory
    for (const rec of statusRecords) {
      memoryStorage.statuses.set(`${params.actorId}:::${rec.statusId}`, rec)
    }

    const persistedSegments: PersistedTimelineSegment[] = trimmedSegments.map(
      (s) => ({
        statusIds: s.statuses.map((st) => st.id),
        nextMaxStatusId: s.nextMaxStatusId,
        prevMinStatusId: s.prevMinStatusId
      })
    )

    const persistedState: PersistedTimelineState = {
      actorId: params.actorId,
      timeline,
      filterKey,
      segments: persistedSegments,
      ancestorsById,
      lastRefreshedAt,
      scrollAnchor
    }

    memoryStorage.timelines.set(
      `${params.actorId}:::${timeline}:::${filterKey}`,
      persistedState
    )

    const db = await openDb()
    if (db) {
      try {
        const tx = createIdbTx(db, ['statuses', 'timelines'], 'readwrite')
        const done = waitForTransaction(tx)
        const statusStore = tx.objectStore('statuses')
        for (const rec of statusRecords) {
          statusStore.put(rec)
        }
        const timelineStore = tx.objectStore('timelines')
        timelineStore.put(persistedState)
        await done
      } catch {
        // memory already updated
      }
    }

    // Garbage-collect unreferenced statuses for this actorId
    // 1. In memory
    const referencedIds = new Set<string>()
    for (const tl of memoryStorage.timelines.values()) {
      if (tl.actorId === params.actorId) {
        for (const seg of tl.segments) {
          for (const id of seg.statusIds) {
            referencedIds.add(id)
          }
        }
      }
    }
    for (const [key, rec] of memoryStorage.statuses.entries()) {
      if (rec.actorId === params.actorId && !referencedIds.has(rec.statusId)) {
        memoryStorage.statuses.delete(key)
      }
    }

    // 2. In IndexedDB
    if (db) {
      try {
        const tx = createIdbTx(db, ['timelines', 'statuses'], 'readwrite')
        const done = waitForTransaction(tx)
        const timelineStore = tx.objectStore('timelines')
        const statusStore = tx.objectStore('statuses')

        const idbTimelines = (await promisifyRequest(
          timelineStore.index('byActor').getAll(params.actorId)
        )) as PersistedTimelineState[]

        const idbReferencedIds = new Set<string>()
        for (const tl of idbTimelines) {
          for (const seg of tl.segments) {
            for (const id of seg.statusIds) {
              idbReferencedIds.add(id)
            }
          }
        }

        const statusIndex = statusStore.index('byActor')
        if (typeof statusIndex.getAllKeys === 'function') {
          const keys = (await promisifyRequest(
            statusIndex.getAllKeys(params.actorId)
          )) as [string, string][]
          for (const key of keys) {
            const statusId = Array.isArray(key) ? key[1] : undefined
            if (statusId && !idbReferencedIds.has(statusId)) {
              statusStore.delete(key)
            }
          }
        } else {
          const idbStatuses = (await promisifyRequest(
            statusIndex.getAll(params.actorId)
          )) as PersistedStatusRecord[]

          for (const st of idbStatuses) {
            if (!idbReferencedIds.has(st.statusId)) {
              statusStore.delete([params.actorId, st.statusId])
            }
          }
        }
        await done
      } catch {
        // ignore
      }
    }
  } catch {
    // safe ignore
  }
}

export const saveOfflineScrollAnchor = async (params: {
  actorId: string
  timeline?: string
  filterKey?: string
  scrollAnchor: ScrollAnchorState | null
}): Promise<void> => {
  try {
    const timeline = params.timeline || 'home'
    const filterKey = params.filterKey || 'all'
    const memKey = `${params.actorId}:::${timeline}:::${filterKey}`

    const memExisting = memoryStorage.timelines.get(memKey)
    if (memExisting) {
      memExisting.scrollAnchor = params.scrollAnchor
    }

    const db = await openDb()
    if (db) {
      try {
        const tx = createIdbTx(db, 'timelines', 'readwrite')
        const done = waitForTransaction(tx)
        const store = tx.objectStore('timelines')
        const existing = (await promisifyRequest(
          store.get([params.actorId, timeline, filterKey])
        )) as PersistedTimelineState | undefined
        if (existing) {
          existing.scrollAnchor = params.scrollAnchor
          store.put(existing)
          await done
        }
      } catch {
        // memory already updated
      }
    }
  } catch {
    // safe ignore
  }
}

export const clearActorOfflineData = async (actorId: string): Promise<void> => {
  try {
    memoryStorage.bootstrap.delete(actorId)
    for (const key of Array.from(memoryStorage.statuses.keys())) {
      if (key.startsWith(`${actorId}:::`)) {
        memoryStorage.statuses.delete(key)
      }
    }
    for (const key of Array.from(memoryStorage.timelines.keys())) {
      if (key.startsWith(`${actorId}:::`)) {
        memoryStorage.timelines.delete(key)
      }
    }
    const active = memoryStorage.meta.get('activeSession') as
      ActiveOfflineSessionMeta | undefined
    if (active && active.actorId === actorId) {
      memoryStorage.meta.delete('activeSession')
    }

    const db = await openDb()
    if (db) {
      try {
        const tx = createIdbTx(
          db,
          ['meta', 'bootstrap', 'statuses', 'timelines'],
          'readwrite'
        )
        const done = waitForTransaction(tx)
        tx.objectStore('bootstrap').delete(actorId)

        const statusStore = tx.objectStore('statuses')
        const statusKeys = (await promisifyRequest(
          statusStore.index('byActor').getAllKeys(actorId)
        )) as IDBValidKey[]
        for (const k of statusKeys) {
          statusStore.delete(k)
        }

        const timelineStore = tx.objectStore('timelines')
        const timelineKeys = (await promisifyRequest(
          timelineStore.index('byActor').getAllKeys(actorId)
        )) as IDBValidKey[]
        for (const k of timelineKeys) {
          timelineStore.delete(k)
        }

        const metaStore = tx.objectStore('meta')
        const metaActive = (await promisifyRequest(
          metaStore.get('activeSession')
        )) as ActiveOfflineSessionMeta | undefined
        if (metaActive && metaActive.actorId === actorId) {
          metaStore.delete('activeSession')
        }
        await done
      } catch {
        // ignore
      }
    }
  } catch {
    // safe ignore
  }
}

export const clearAllOfflineData = async (): Promise<void> => {
  try {
    memoryStorage.meta.clear()
    memoryStorage.bootstrap.clear()
    memoryStorage.statuses.clear()
    memoryStorage.timelines.clear()

    const db = await openDb()
    if (db) {
      try {
        const tx = createIdbTx(
          db,
          ['meta', 'bootstrap', 'statuses', 'timelines'],
          'readwrite'
        )
        const done = waitForTransaction(tx)
        tx.objectStore('meta').clear()
        tx.objectStore('bootstrap').clear()
        tx.objectStore('statuses').clear()
        tx.objectStore('timelines').clear()
        await done
      } catch {
        // ignore
      }
    }

    if (typeof caches !== 'undefined' && typeof caches.delete === 'function') {
      try {
        await caches.delete('activities-media-v1')
      } catch {
        // safe ignore
      }
    }
  } catch {
    // safe ignore
  }
}

export const requestPersistentOfflineStorage = async (): Promise<boolean> => {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      return await navigator.storage.persist()
    }
  } catch {
    // safe fallback
  }
  return false
}

export const resetOfflineDbForTesting = async (): Promise<void> => {
  memoryStorage.meta.clear()
  memoryStorage.bootstrap.clear()
  memoryStorage.statuses.clear()
  memoryStorage.timelines.clear()
  openDbPromise = null
  if (cachedDb) {
    try {
      cachedDb.close()
    } catch {
      // ignore
    }
    cachedDb = null
  }
  const factory = getFactory()
  if (factory && typeof factory.deleteDatabase === 'function') {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = factory.deleteDatabase(OFFLINE_DB_NAME)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
        req.onblocked = () => resolve()
      })
    } catch {
      // ignore
    }
  }
}
