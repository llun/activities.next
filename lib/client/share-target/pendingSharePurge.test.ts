/**
 * @vitest-environment jsdom
 * @vitest-size medium
 */
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  markSharePurgePending,
  readSharePurgePending,
  settleSharePurge
} from './pendingSharePurge'
import {
  honourPendingSharePurge,
  peekStagedShare,
  stageShareFiles
} from './shareTargetDb'

const file = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

// An IndexedDB whose every open fails, as a broken store does.
const brokenIndexedDB = {
  open: () => {
    const request: { onerror?: () => void; error: Error } = {
      error: new Error('broken')
    }
    setTimeout(() => request.onerror?.(), 0)
    return request
  }
}

// An in-memory Cache Storage (jsdom has none). `onNextDelete` runs a write
// just as a delete happens, the window the race review found.
const fakeCacheStorage = () => {
  const stores = new Map<string, Map<string, Response>>()
  let beforeDelete: (() => Promise<unknown>) | null = null
  let keysFail = false
  const keyOf = (request: RequestInfo | URL) =>
    typeof request === 'string'
      ? request
      : request instanceof URL
        ? request.href
        : request.url
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      put: async (request: RequestInfo | URL, response: Response) => {
        store.set(keyOf(request), response)
      },
      match: async (request: RequestInfo | URL) =>
        store.get(keyOf(request))?.clone(),
      keys: async () => {
        if (keysFail) throw new Error('keys rejected')
        return Array.from(store.keys(), (key) => new Request(key))
      },
      delete: async (request: RequestInfo | URL) => {
        const hook = beforeDelete
        beforeDelete = null
        if (hook) await hook()
        return store.delete(keyOf(request))
      }
    }
  }
  return {
    caches: { open, delete: async (name: string) => stores.delete(name) },
    onNextDelete: (hook: () => Promise<unknown>) => {
      beforeDelete = hook
    },
    failKeys: () => {
      keysFail = true
    }
  }
}

describe('pending share purge', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('reads every share when no purge is pending', async () => {
    const id = await stageShareFiles([file('a.jpg')])

    expect(await honourPendingSharePurge()).toBe(true)
    expect(await peekStagedShare(id!)).not.toBeNull()
  })

  // A sign-out whose clear failed: the next reader purges the previous
  // account's shares before reading anything, and keeps any made since.
  it('purges the shares staged up to the sign-out, keeps later ones, and settles', async () => {
    const before = await stageShareFiles([file('old.jpg')])
    const markedAt = Date.now()
    await markSharePurgePending(markedAt)
    vi.spyOn(Date, 'now').mockReturnValue(markedAt + 1000)
    const after = await stageShareFiles([file('new.jpg')])
    vi.mocked(Date.now).mockRestore()

    expect(await honourPendingSharePurge()).toBe(true)

    expect(await peekStagedShare(before!)).toBeNull()
    expect(await peekStagedShare(after!)).not.toBeNull()
    expect(await readSharePurgePending()).toBe('none')
  })

  it('keeps the marker, and allows no read, while the purge still fails', async () => {
    await markSharePurgePending(Date.now())
    vi.stubGlobal('indexedDB', brokenIndexedDB)

    expect(await honourPendingSharePurge()).toBe(false)
    expect(await readSharePurgePending()).not.toBe('none')
  })

  // localStorage writes failing (private mode) leave Cache Storage as the
  // only copy of the marker.
  describe('with only Cache Storage', () => {
    let storage: ReturnType<typeof fakeCacheStorage>

    beforeEach(() => {
      storage = fakeCacheStorage()
      vi.stubGlobal('caches', storage.caches)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('keeps the marker in the cache until it is settled', async () => {
      await markSharePurgePending(1000)
      expect(
        localStorage.getItem('activities-share-target-pending-purge')
      ).toBeNull()
      expect(await readSharePurgePending()).toEqual({ markedAt: 1000 })

      await settleSharePurge(1000)

      expect(await readSharePurgePending()).toBe('none')
    })

    // The interleaving the race review reproduced: the reader retires T1
    // while account B's sign-out writes T2 at that very moment. B's share
    // must still be purged (or nothing read), never left readable.
    it('purges a newer marker written as the older one is retired', async () => {
      const t1 = Date.now()
      await markSharePurgePending(t1)
      vi.spyOn(Date, 'now').mockReturnValue(t1 + 500)
      const workout = await stageShareFiles([file('ride.fit')])
      vi.mocked(Date.now).mockRestore()
      storage.onNextDelete(() => markSharePurgePending(t1 + 1000))

      expect(await honourPendingSharePurge()).toBe(true)

      expect(await peekStagedShare(workout!)).toBeNull()
      expect(await readSharePurgePending()).toBe('none')
    })

    // The reproduction: sign-out wrote only the cache marker and its clear
    // failed; IndexedDB recovers, but listing the marker cache rejects. An
    // unreadable marker must not read as "none".
    it('reads nothing when the marker cache cannot be listed', async () => {
      const workout = await stageShareFiles([file('ride.fit')])
      await markSharePurgePending(Date.now() + 1)
      storage.failKeys()

      expect(await readSharePurgePending()).toBe('unreadable')
      expect(await honourPendingSharePurge()).toBe(false)
      // Not purged (the marker could not be read) and, above all, not read.
      expect(await peekStagedShare(workout!)).not.toBeNull()
    })

    it('settles only the generations at or before the purged time', async () => {
      await markSharePurgePending(1000)
      await markSharePurgePending(2000)

      await settleSharePurge(1000)

      expect(await readSharePurgePending()).toEqual({ markedAt: 2000 })
    })
  })

  it('reads as none when the browser has no Cache Storage at all', async () => {
    expect(typeof caches).toBe('undefined')

    expect(await readSharePurgePending()).toBe('none')
    expect(await honourPendingSharePurge()).toBe(true)
  })

  it('fails closed when reading localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    try {
      expect(await readSharePurgePending()).toBe('unreadable')
      expect(await honourPendingSharePurge()).toBe(false)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('removes the marker once settled', async () => {
    await markSharePurgePending(1234)
    expect(await readSharePurgePending()).toEqual({ markedAt: 1234 })

    await settleSharePurge(1234)

    expect(await readSharePurgePending()).toBe('none')
  })

  // A newer sign-out wrote its marker while an older purge was running: the
  // older purge must not retire it.
  it('keeps a newer marker when settling an older one', async () => {
    await markSharePurgePending(1000)
    await markSharePurgePending(2000)

    await settleSharePurge(1000)

    expect(await readSharePurgePending()).toEqual({ markedAt: 2000 })
  })

  // The interleaving review reproduced: a reader starts purging marker T1 and
  // waits on IndexedDB; meanwhile account B, which staged a workout after T1,
  // signs out elsewhere (T2) and its clear fails. When the first purge
  // resumes, B's workout must still be purged before anything is read.
  it('purges a newer marker written during the purge before allowing a read', async () => {
    const t1 = Date.now()
    await markSharePurgePending(t1)
    vi.spyOn(Date, 'now').mockReturnValue(t1 + 500)
    const workout = await stageShareFiles([file('ride.fit')])
    vi.mocked(Date.now).mockRestore()

    const honoured = honourPendingSharePurge()
    // Written synchronously while the purge of T1 waits on IndexedDB.
    void markSharePurgePending(t1 + 1000)

    expect(await honoured).toBe(true)
    expect(await peekStagedShare(workout!)).toBeNull()
    expect(await readSharePurgePending()).toBe('none')
  })
})
