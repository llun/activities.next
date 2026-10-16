import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

import {
  clearActorOfflineData,
  clearAllOfflineData,
  getActiveOfflineSession,
  getClientBootstrapSnapshot,
  getOfflineTimeline,
  requestPersistentOfflineStorage,
  resetOfflineDbForTesting,
  saveClientBootstrapSnapshot,
  saveOfflineScrollAnchor,
  saveOfflineTimeline,
  setActiveOfflineSession,
  setForceMemoryOnly
} from './offlineDb'
import {
  ClientBootstrapSnapshot,
  HydratedTimelineSegment,
  MAX_CACHED_STATUSES_PER_TIMELINE
} from './types'

const mockStatus = (id: string, text = 'hello'): Status =>
  ({
    id,
    type: StatusType.enum.Note,
    actorId: 'https://llun.test/users/alice',
    text
  }) as unknown as Status

const mockBootstrap = (
  actorId: string,
  savedAt = Date.now()
): ClientBootstrapSnapshot => ({
  accountId: `acc-${actorId}`,
  actorId,
  host: 'llun.test',
  currentTime: savedAt,
  user: {
    name: 'Alice',
    username: 'alice',
    handle: '@alice@llun.test'
  },
  currentActor: {
    id: actorId,
    username: 'alice',
    domain: 'llun.test'
  },
  actors: [],
  profile: {
    id: actorId,
    username: 'alice',
    domain: 'llun.test',
    createdAt: savedAt
  } as unknown as ActorProfile,
  unreadCount: 0,
  isAdmin: false,
  isMediaUploadEnabled: true,
  lists: [],
  features: {
    fitness: true,
    pushNotifications: false
  },
  instanceLimits: {
    maxStatusCharacters: 500,
    maxMediaFileSize: 10485760,
    maxMediaAttachments: 4,
    maxPollOptions: 4,
    maxPollOptionCharacters: 50,
    minPollExpirationSeconds: 300,
    maxPollExpirationSeconds: 2592000
  },
  readingAutoplayGifs: true,
  readingGroupBoosts: true,
  savedAt
})

describe('offlineDb storage layer', () => {
  beforeEach(async () => {
    setForceMemoryOnly(true)
    await resetOfflineDbForTesting()
  })

  describe('active session', () => {
    it('returns null when no active session is set', async () => {
      const session = await getActiveOfflineSession()
      expect(session).toBeNull()
    })

    it('persists and retrieves active offline session', async () => {
      await setActiveOfflineSession({
        accountId: 'acc-1',
        actorId: 'https://llun.test/users/alice',
        updatedAt: 1000
      })

      const session = await getActiveOfflineSession()
      expect(session).toEqual({
        key: 'activeSession',
        accountId: 'acc-1',
        actorId: 'https://llun.test/users/alice',
        updatedAt: 1000
      })
    })
  })

  describe('client bootstrap snapshot & LRU eviction', () => {
    it('saves and retrieves client bootstrap snapshot and updates active session', async () => {
      const snapshot = mockBootstrap('https://llun.test/users/alice', 5000)
      await saveClientBootstrapSnapshot(snapshot)

      const retrieved = await getClientBootstrapSnapshot(
        'https://llun.test/users/alice'
      )
      expect(retrieved).toEqual(snapshot)

      const activeSession = await getActiveOfflineSession()
      expect(activeSession?.actorId).toBe('https://llun.test/users/alice')
      expect(activeSession?.updatedAt).toBe(5000)
    })

    it('enforces MAX_CACHED_ACTORS = 3 LRU eviction across bootstrap, statuses and timelines', async () => {
      // Save 4 actors in sequence: actor1, actor2, actor3, actor4
      const a1 = mockBootstrap('https://llun.test/users/a1', 1000)
      const a2 = mockBootstrap('https://llun.test/users/a2', 2000)
      const a3 = mockBootstrap('https://llun.test/users/a3', 3000)
      const a4 = mockBootstrap('https://llun.test/users/a4', 4000)

      await saveClientBootstrapSnapshot(a1)
      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/a1',
        segments: [
          {
            statuses: [mockStatus('s1')],
            nextMaxStatusId: null,
            prevMinStatusId: 's1'
          }
        ]
      })

      await saveClientBootstrapSnapshot(a2)
      await saveClientBootstrapSnapshot(a3)

      // At this point a1, a2, a3 are cached
      expect(
        await getClientBootstrapSnapshot('https://llun.test/users/a1')
      ).not.toBeNull()

      // Now save a4: a1 should be evicted (lowest savedAt: 1000)
      await saveClientBootstrapSnapshot(a4)

      expect(
        await getClientBootstrapSnapshot('https://llun.test/users/a1')
      ).toBeNull()
      expect(
        await getClientBootstrapSnapshot('https://llun.test/users/a2')
      ).not.toBeNull()
      expect(
        await getClientBootstrapSnapshot('https://llun.test/users/a3')
      ).not.toBeNull()
      expect(
        await getClientBootstrapSnapshot('https://llun.test/users/a4')
      ).not.toBeNull()

      // Check that a1's timeline is also purged
      const a1Timeline = await getOfflineTimeline({
        actorId: 'https://llun.test/users/a1'
      })
      expect(a1Timeline).toBeNull()
    })
  })

  describe('timeline persistence and hydration', () => {
    it('returns null when timeline does not exist', async () => {
      const timeline = await getOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home'
      })
      expect(timeline).toBeNull()
    })

    it('saves and hydrates offline timeline with segments, statuses, and cursors', async () => {
      const s1 = mockStatus('https://llun.test/statuses/1', 'first')
      const s2 = mockStatus('https://llun.test/statuses/2', 'second')
      const s3 = mockStatus('https://llun.test/statuses/3', 'third')

      const segments: HydratedTimelineSegment[] = [
        {
          statuses: [s1, s2],
          nextMaxStatusId: 'gap-cursor',
          prevMinStatusId: s1.id
        },
        {
          statuses: [s3],
          nextMaxStatusId: 'end-cursor',
          prevMinStatusId: s3.id
        }
      ]

      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home',
        filterKey: 'all',
        segments,
        lastRefreshedAt: 12345
      })

      const loaded = await getOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home',
        filterKey: 'all'
      })

      expect(loaded).not.toBeNull()
      expect(loaded?.actorId).toBe('https://llun.test/users/alice')
      expect(loaded?.timeline).toBe('home')
      expect(loaded?.filterKey).toBe('all')
      expect(loaded?.segments).toHaveLength(2)
      expect(loaded?.segments[0].statuses.map((s) => s.id)).toEqual([
        s1.id,
        s2.id
      ])
      expect(loaded?.segments[1].statuses.map((s) => s.id)).toEqual([s3.id])
      expect(loaded?.statuses.map((s) => s.id)).toEqual([s1.id, s2.id, s3.id])
      expect(loaded?.nextMaxStatusId).toBe('end-cursor')
      expect(loaded?.lastRefreshedAt).toBe(12345)
    })

    it('garbage-collects unreferenced statuses for the actor', async () => {
      const s1 = mockStatus('s1')
      const s2 = mockStatus('s2')
      const s3 = mockStatus('s3')

      // First save timeline with s1, s2, s3
      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home',
        segments: [
          {
            statuses: [s1, s2, s3],
            nextMaxStatusId: null,
            prevMinStatusId: s1.id
          }
        ]
      })

      // Second save timeline with only s1 (s2 and s3 are now unreferenced!)
      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home',
        segments: [
          { statuses: [s1], nextMaxStatusId: null, prevMinStatusId: s1.id }
        ]
      })

      const loaded = await getOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home'
      })
      expect(loaded?.statuses.map((s) => s.id)).toEqual([s1.id])
    })

    it('enforces MAX_CACHED_STATUSES_PER_TIMELINE = 200 on save', async () => {
      const largeStatuses: Status[] = []
      for (let i = 0; i < 250; i++) {
        largeStatuses.push(mockStatus(`status-${i}`))
      }

      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home',
        segments: [
          {
            statuses: largeStatuses,
            nextMaxStatusId: 'tail',
            prevMinStatusId: 'status-0'
          }
        ]
      })

      const loaded = await getOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home'
      })

      expect(loaded?.statuses).toHaveLength(MAX_CACHED_STATUSES_PER_TIMELINE)
      // The cut segment's cursor moves to the last post that was kept.
      expect(loaded?.segments[0].nextMaxStatusId).toBe('status-199')
      expect(loaded?.nextMaxStatusId).toBe('status-199')
      expect(loaded?.statuses[0].id).toBe('status-0')
      expect(loaded?.statuses[199].id).toBe('status-199')
    })
  })

  describe('scroll anchor state', () => {
    it('persists and updates scroll anchor in timeline', async () => {
      const s1 = mockStatus('s1')
      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home',
        segments: [
          { statuses: [s1], nextMaxStatusId: null, prevMinStatusId: s1.id }
        ]
      })

      await saveOfflineScrollAnchor({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home',
        scrollAnchor: {
          statusId: 's1',
          offsetTop: 150,
          updatedAt: 7777
        }
      })

      const loaded = await getOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home'
      })
      expect(loaded?.scrollAnchor).toEqual({
        statusId: 's1',
        offsetTop: 150,
        updatedAt: 7777
      })
    })
  })

  describe('scroll anchor beyond the cache', () => {
    it('returns no scroll anchor when the anchored status was not kept', async () => {
      const statuses: Status[] = []
      for (let i = 0; i < 250; i++) {
        statuses.push(mockStatus(`status-${i}`))
      }
      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home',
        segments: [
          {
            statuses,
            nextMaxStatusId: null,
            prevMinStatusId: 'status-0'
          }
        ]
      })
      await saveOfflineScrollAnchor({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home',
        scrollAnchor: { statusId: 'status-230', offsetTop: 10, updatedAt: 1 }
      })

      const loaded = await getOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        timeline: 'home'
      })
      expect(loaded?.statuses).toHaveLength(MAX_CACHED_STATUSES_PER_TIMELINE)
      expect(loaded?.scrollAnchor).toBeNull()
    })
  })

  describe('clear operations', () => {
    it('clearActorOfflineData removes only the specified actor data', async () => {
      const a1 = mockBootstrap('https://llun.test/users/alice', 1000)
      const a2 = mockBootstrap('https://llun.test/users/bob', 2000)

      await saveClientBootstrapSnapshot(a1)
      await saveClientBootstrapSnapshot(a2)

      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        segments: [
          {
            statuses: [mockStatus('s1')],
            nextMaxStatusId: null,
            prevMinStatusId: 's1'
          }
        ]
      })
      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/bob',
        segments: [
          {
            statuses: [mockStatus('s2')],
            nextMaxStatusId: null,
            prevMinStatusId: 's2'
          }
        ]
      })

      await clearActorOfflineData('https://llun.test/users/alice')

      expect(
        await getClientBootstrapSnapshot('https://llun.test/users/alice')
      ).toBeNull()
      expect(
        await getOfflineTimeline({ actorId: 'https://llun.test/users/alice' })
      ).toBeNull()

      expect(
        await getClientBootstrapSnapshot('https://llun.test/users/bob')
      ).not.toBeNull()
      expect(
        await getOfflineTimeline({ actorId: 'https://llun.test/users/bob' })
      ).not.toBeNull()
    })

    it('clearAllOfflineData wipes everything cleanly', async () => {
      await saveClientBootstrapSnapshot(
        mockBootstrap('https://llun.test/users/alice')
      )
      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/alice',
        segments: [
          {
            statuses: [mockStatus('s1')],
            nextMaxStatusId: null,
            prevMinStatusId: 's1'
          }
        ]
      })

      await clearAllOfflineData()

      expect(await getActiveOfflineSession()).toBeNull()
      expect(
        await getClientBootstrapSnapshot('https://llun.test/users/alice')
      ).toBeNull()
      expect(
        await getOfflineTimeline({ actorId: 'https://llun.test/users/alice' })
      ).toBeNull()
    })
  })

  describe('persistent storage request', () => {
    it('safely handles requestPersistentOfflineStorage in node environment', async () => {
      const persisted = await requestPersistentOfflineStorage()
      expect(persisted).toBe(false)
    })

    it('returns true when navigator.storage.persist succeeds', async () => {
      const originalStorage = Object.getOwnPropertyDescriptor(
        globalThis.navigator,
        'storage'
      )
      const persistMock = vi.fn().mockResolvedValue(true)
      Object.defineProperty(globalThis.navigator, 'storage', {
        value: { persist: persistMock },
        configurable: true,
        writable: true
      })
      try {
        const res = await requestPersistentOfflineStorage()
        expect(res).toBe(true)
        expect(persistMock).toHaveBeenCalled()
      } finally {
        if (originalStorage) {
          Object.defineProperty(
            globalThis.navigator,
            'storage',
            originalStorage
          )
        } else {
          // @ts-expect-error cleanup storage
          delete globalThis.navigator.storage
        }
      }
    })
  })

  describe('caches deletion on clearAllOfflineData', () => {
    it('deletes activities-media-v1 cache if caches API exists', async () => {
      const originalCaches = (globalThis as unknown as { caches: unknown })
        .caches
      try {
        const deleteMock = vi.fn().mockResolvedValue(true)
        // @ts-expect-error mocking caches
        globalThis.caches = { delete: deleteMock }
        await clearAllOfflineData()
        expect(deleteMock).toHaveBeenCalledWith('activities-media-v1')
      } finally {
        // @ts-expect-error restoring caches
        globalThis.caches = originalCaches
      }
    })
  })

  describe('real IndexedDB flow with custom IDBFactory', () => {
    interface MockRequest<T = unknown> {
      result: T
      error: DOMException | null
      onsuccess: ((ev: unknown) => void) | null
      onerror: ((ev: unknown) => void) | null
      onupgradeneeded?: ((ev: unknown) => void) | null
      onblocked?: ((ev: unknown) => void) | null
    }

    interface MockDbRecord {
      actorId?: string
      [key: string]: unknown
    }

    const createMockIDBFactory = () => {
      const dbs = new Map<
        string,
        {
          db: {
            objectStoreNames: { contains: (sName: string) => boolean }
            createObjectStore: (
              sName: string,
              config: { keyPath?: string | string[] }
            ) => { createIndex: () => void }
            transaction: (
              storeNames: string | string[],
              mode: string
            ) => {
              mode: string
              oncomplete: (() => void) | null
              onerror: ((err: unknown) => void) | null
              onabort: ((err: unknown) => void) | null
              objectStore: (sName: string) => {
                get: (key: unknown) => MockRequest
                getAll: () => MockRequest<unknown[]>
                put: (val: MockDbRecord) => MockRequest
                delete: (key: unknown) => MockRequest
                clear: () => MockRequest
                index: (_idxName: string) => {
                  getAll: (queryKey: unknown) => MockRequest<unknown[]>
                  getAllKeys: (queryKey: unknown) => MockRequest<unknown[]>
                }
              }
            }
            close: () => void
          }
          version: number
        }
      >()

      const factory = {
        open: (name: string, version: number) => {
          const req: MockRequest = {
            result: null,
            error: null,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
            onblocked: null
          }

          setTimeout(() => {
            let entry = dbs.get(name)
            let isUpgrade = false
            if (!entry) {
              isUpgrade = true
              const stores = new Map<string, Map<string, MockDbRecord>>()
              const storeConfigs = new Map<
                string,
                { keyPath?: string | string[] }
              >()
              const dbObj = {
                objectStoreNames: {
                  contains: (sName: string) => stores.has(sName)
                },
                createObjectStore: (
                  sName: string,
                  config: { keyPath?: string | string[] }
                ) => {
                  stores.set(sName, new Map())
                  storeConfigs.set(sName, config)
                  return {
                    createIndex: vi.fn()
                  }
                },
                transaction: (storeNames: string | string[], mode: string) => {
                  const tx = {
                    mode,
                    oncomplete: null as (() => void) | null,
                    onerror: null as ((err: unknown) => void) | null,
                    onabort: null as ((err: unknown) => void) | null,
                    objectStore: (sName: string) => {
                      const dataMap = stores.get(sName)!
                      const config = storeConfigs.get(sName)
                      return {
                        get: (key: unknown) => {
                          const getReq: MockRequest = {
                            result: undefined,
                            error: null,
                            onsuccess: null,
                            onerror: null
                          }
                          setTimeout(() => {
                            getReq.result = dataMap.get(JSON.stringify(key))
                            getReq.onsuccess?.({ target: getReq })
                          }, 0)
                          return getReq
                        },
                        getAll: () => {
                          const getAllReq: MockRequest<unknown[]> = {
                            result: [],
                            error: null,
                            onsuccess: null,
                            onerror: null
                          }
                          setTimeout(() => {
                            getAllReq.result = Array.from(dataMap.values())
                            getAllReq.onsuccess?.({ target: getAllReq })
                          }, 0)
                          return getAllReq
                        },
                        put: (val: MockDbRecord) => {
                          let keyVal: unknown = val
                          if (config?.keyPath) {
                            if (Array.isArray(config.keyPath)) {
                              keyVal = config.keyPath.map(
                                (kp: string) => val[kp]
                              )
                            } else {
                              keyVal = val[config.keyPath]
                            }
                          }
                          const putReq: MockRequest = {
                            result: keyVal,
                            error: null,
                            onsuccess: null,
                            onerror: null
                          }
                          dataMap.set(JSON.stringify(keyVal), val)
                          setTimeout(() => {
                            putReq.onsuccess?.({ target: putReq })
                          }, 0)
                          return putReq
                        },
                        delete: (key: unknown) => {
                          const delReq: MockRequest = {
                            result: undefined,
                            error: null,
                            onsuccess: null,
                            onerror: null
                          }
                          dataMap.delete(JSON.stringify(key))
                          setTimeout(() => {
                            delReq.onsuccess?.({ target: delReq })
                          }, 0)
                          return delReq
                        },
                        clear: () => {
                          dataMap.clear()
                          const clReq: MockRequest = {
                            result: undefined,
                            error: null,
                            onsuccess: null,
                            onerror: null
                          }
                          setTimeout(
                            () => clReq.onsuccess?.({ target: clReq }),
                            0
                          )
                          return clReq
                        },
                        index: (_idxName: string) => ({
                          getAll: (queryKey: unknown) => {
                            const idxReq: MockRequest<unknown[]> = {
                              result: [],
                              error: null,
                              onsuccess: null,
                              onerror: null
                            }
                            setTimeout(() => {
                              const results: unknown[] = []
                              for (const v of dataMap.values()) {
                                if (v.actorId === queryKey) results.push(v)
                              }
                              idxReq.result = results
                              idxReq.onsuccess?.({ target: idxReq })
                            }, 0)
                            return idxReq
                          },
                          getAllKeys: (queryKey: unknown) => {
                            const idxReq: MockRequest<unknown[]> = {
                              result: [],
                              error: null,
                              onsuccess: null,
                              onerror: null
                            }
                            setTimeout(() => {
                              const keys: unknown[] = []
                              for (const [kStr, v] of dataMap.entries()) {
                                if (v.actorId === queryKey)
                                  keys.push(JSON.parse(kStr))
                              }
                              idxReq.result = keys
                              idxReq.onsuccess?.({ target: idxReq })
                            }, 0)
                            return idxReq
                          }
                        })
                      }
                    }
                  }
                  setTimeout(() => {
                    tx.oncomplete?.()
                  }, 5)
                  return tx
                },
                close: () => {}
              }
              entry = { db: dbObj, version }
              dbs.set(name, entry)
            }

            req.result = entry.db
            if (isUpgrade && req.onupgradeneeded) {
              req.onupgradeneeded({ target: req })
            }
            req.onsuccess?.({ target: req })
          }, 0)

          return req
        },
        deleteDatabase: (name: string) => {
          dbs.delete(name)
          const req: MockRequest = {
            result: undefined,
            error: null,
            onsuccess: null,
            onerror: null
          }
          setTimeout(() => req.onsuccess?.({ target: req }), 0)
          return req
        }
      }

      return factory as unknown as IDBFactory
    }

    it('works with simulated IndexedDB factory and exercises upgrade and transactions', async () => {
      const mockFactory = createMockIDBFactory()
      setForceMemoryOnly(false)
      const { setIndexedDBFactory } = await import('./offlineDb')
      setIndexedDBFactory(mockFactory)

      const snapshot = mockBootstrap('https://llun.test/users/bob', 9999)
      await saveClientBootstrapSnapshot(snapshot)

      const loadedSnapshot = await getClientBootstrapSnapshot(
        'https://llun.test/users/bob'
      )
      expect(loadedSnapshot).toEqual(snapshot)

      const s1 = mockStatus('status-idb-1', 'hello from IDB')
      await saveOfflineTimeline({
        actorId: 'https://llun.test/users/bob',
        timeline: 'home',
        segments: [
          { statuses: [s1], nextMaxStatusId: null, prevMinStatusId: s1.id }
        ]
      })

      const loadedTimeline = await getOfflineTimeline({
        actorId: 'https://llun.test/users/bob',
        timeline: 'home'
      })
      expect(loadedTimeline?.statuses.map((s) => s.id)).toEqual([s1.id])

      // Clean up
      setIndexedDBFactory(null)
      setForceMemoryOnly(true)
    })

    it('detects missing object stores, deletes corrupted/empty database, and recreates all stores cleanly', async () => {
      const mockFactory = createMockIDBFactory()
      // Pre-create an empty v1 database without stores (simulating a broken/empty v1 DB)
      const corruptReq = mockFactory.open('activities_offline_v1', 1)
      await new Promise<void>((resolve) => {
        corruptReq.onsuccess = () => resolve()
      })

      setForceMemoryOnly(false)
      const { setIndexedDBFactory } = await import('./offlineDb')
      setIndexedDBFactory(mockFactory)

      const snapshot = mockBootstrap('https://llun.test/users/carol', 8888)
      await saveClientBootstrapSnapshot(snapshot)

      const loadedSnapshot = await getClientBootstrapSnapshot(
        'https://llun.test/users/carol'
      )
      expect(loadedSnapshot).toEqual(snapshot)

      // Clean up
      setIndexedDBFactory(null)
      setForceMemoryOnly(true)
    })
  })
})
