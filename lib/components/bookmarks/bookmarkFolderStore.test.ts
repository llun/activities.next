/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'

import { getBookmarkFolders } from '@/lib/client'
import type { BookmarkFolderEntity } from '@/lib/services/bookmarks/bookmarkFolders'

import {
  loadBookmarkFolders,
  putBookmarkFolder,
  removeBookmarkFolder,
  resetBookmarkFolderStore,
  seedBookmarkFolders,
  setBookmarkFolders,
  useBookmarkFolders
} from './bookmarkFolderStore'

vi.mock('@/lib/client', () => ({ getBookmarkFolders: vi.fn() }))

const ACTOR_A = 'https://llun.test/users/a'
const ACTOR_B = 'https://llun.test/users/b'

const folder = (id: string, name: string): BookmarkFolderEntity => ({
  id,
  name,
  created_at: '2026-04-26T10:00:00.000Z',
  updated_at: '2026-04-26T10:00:00.000Z'
})

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const names = (state: { folders: BookmarkFolderEntity[] }) =>
  state.folders.map((item) => item.name)

describe('bookmark folder store', () => {
  beforeEach(() => {
    vi.mocked(getBookmarkFolders).mockReset()
    resetBookmarkFolderStore()
  })

  it('keeps a folder made after a failed load without claiming the list is whole', async () => {
    vi.mocked(getBookmarkFolders)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([folder('old', 'Old'), folder('new', 'New')])
    const { result } = renderHook(() => useBookmarkFolders(ACTOR_A))

    await act(() => loadBookmarkFolders(ACTOR_A))
    expect(result.current.status).toBe('error')

    act(() => putBookmarkFolder(ACTOR_A, folder('new', 'New')))
    expect(result.current.status).toBe('error')
    expect(names(result.current)).toEqual(['New'])

    // The next menu open reads the whole list, the old folder included.
    await act(() => loadBookmarkFolders(ACTOR_A))
    expect(result.current.status).toBe('loaded')
    expect(names(result.current)).toEqual(['New', 'Old'])
  })

  it('does not let a slow load drop a folder made while it ran', async () => {
    const slow = deferred<BookmarkFolderEntity[]>()
    vi.mocked(getBookmarkFolders)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([folder('old', 'Old'), folder('new', 'New')])
    const { result } = renderHook(() => useBookmarkFolders(ACTOR_A))

    let loading: Promise<void> = Promise.resolve()
    act(() => {
      loading = loadBookmarkFolders(ACTOR_A)
    })
    act(() => putBookmarkFolder(ACTOR_A, folder('new', 'New')))
    await act(async () => {
      slow.resolve([folder('old', 'Old')])
      await loading
    })

    expect(getBookmarkFolders).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('loaded')
    expect(names(result.current)).toEqual(['New', 'Old'])
  })

  it('does not let a slow load bring back a folder deleted while it ran', async () => {
    const slow = deferred<BookmarkFolderEntity[]>()
    vi.mocked(getBookmarkFolders)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([])
    const { result } = renderHook(() => useBookmarkFolders(ACTOR_A))

    let loading: Promise<void> = Promise.resolve()
    act(() => {
      loading = loadBookmarkFolders(ACTOR_A)
    })
    act(() => removeBookmarkFolder(ACTOR_A, 'gone'))
    await act(async () => {
      slow.resolve([folder('gone', 'Gone')])
      await loading
    })

    expect(names(result.current)).toEqual([])
    expect(result.current.status).toBe('loaded')
  })

  it("keeps a page's seed over a load that was already in flight", async () => {
    const slow = deferred<BookmarkFolderEntity[]>()
    vi.mocked(getBookmarkFolders).mockReturnValueOnce(slow.promise)
    const { result } = renderHook(() => useBookmarkFolders(ACTOR_A))

    let loading: Promise<void> = Promise.resolve()
    act(() => {
      loading = loadBookmarkFolders(ACTOR_A)
    })
    act(() => setBookmarkFolders(ACTOR_A, [folder('seed', 'Seed')]))
    await act(async () => {
      slow.resolve([folder('stale', 'Stale')])
      await loading
    })

    expect(getBookmarkFolders).toHaveBeenCalledTimes(1)
    expect(names(result.current)).toEqual(['Seed'])
  })

  it('settles a load left in flight across a switch to another actor and back', async () => {
    const firstA = deferred<BookmarkFolderEntity[]>()
    const forB = deferred<BookmarkFolderEntity[]>()
    const secondA = deferred<BookmarkFolderEntity[]>()
    vi.mocked(getBookmarkFolders)
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(forB.promise)
      .mockReturnValueOnce(secondA.promise)
      // A fourth request would be the loop: it never answers, so the test
      // fails on the count instead of spinning.
      .mockImplementation(() => new Promise(() => {}))
    const a = renderHook(() => useBookmarkFolders(ACTOR_A))
    const b = renderHook(() => useBookmarkFolders(ACTOR_B))

    act(() => {
      void loadBookmarkFolders(ACTOR_A)
      void loadBookmarkFolders(ACTOR_B)
      void loadBookmarkFolders(ACTOR_A)
    })
    await act(async () => {
      firstA.resolve([folder('a-old', 'A old')])
      secondA.resolve([folder('a', 'A folder')])
      forB.resolve([folder('b', 'B folder')])
      await new Promise((settle) => setTimeout(settle, 10))
    })

    // Three requests and no more: the overtaken ones did not restart.
    expect(getBookmarkFolders).toHaveBeenCalledTimes(3)
    expect(names(a.result.current)).toEqual(['A folder'])
    expect(a.result.current.status).toBe('loaded')
    expect(b.result.current).toEqual({ folders: [], status: 'idle' })
  })

  it('keeps a newer store over a stale page seed, and refreshes it', async () => {
    vi.mocked(getBookmarkFolders).mockResolvedValue([
      folder('old', 'Old'),
      folder('new', 'New'),
      folder('elsewhere', 'Made elsewhere')
    ])
    const { result } = renderHook(() => useBookmarkFolders(ACTOR_A))
    act(() => setBookmarkFolders(ACTOR_A, [folder('old', 'Old')]))
    act(() => putBookmarkFolder(ACTOR_A, folder('new', 'New')))

    // A router-cache back navigation hands the page its first list again.
    act(() => seedBookmarkFolders(ACTOR_A, [folder('old', 'Old')]))
    expect(names(result.current)).toEqual(['New', 'Old'])

    await act(async () => {
      await vi.waitFor(() => expect(getBookmarkFolders).toHaveBeenCalled())
    })
    await vi.waitFor(() =>
      expect(names(result.current)).toEqual(['Made elsewhere', 'New', 'Old'])
    )
    expect(result.current.status).toBe('loaded')
  })

  it('seeds a store that has not loaded for this actor', () => {
    const { result } = renderHook(() => useBookmarkFolders(ACTOR_A))
    act(() => setBookmarkFolders(ACTOR_B, [folder('b', 'B folder')]))

    act(() => seedBookmarkFolders(ACTOR_A, [folder('a', 'A folder')]))

    expect(getBookmarkFolders).not.toHaveBeenCalled()
    expect(names(result.current)).toEqual(['A folder'])
  })

  it("never shows one actor's folders to another", async () => {
    vi.mocked(getBookmarkFolders).mockResolvedValueOnce([
      folder('b1', 'B only')
    ])
    act(() => setBookmarkFolders(ACTOR_A, [folder('a1', 'A secret')]))
    const forA = renderHook(() => useBookmarkFolders(ACTOR_A))
    const forB = renderHook(() => useBookmarkFolders(ACTOR_B))

    expect(names(forA.result.current)).toEqual(['A secret'])
    expect(forB.result.current).toEqual({ folders: [], status: 'idle' })

    // The session moved to B: B's menu loads B's folders and A's are gone.
    await act(() => loadBookmarkFolders(ACTOR_B))
    expect(names(forB.result.current)).toEqual(['B only'])
    expect(forA.result.current).toEqual({ folders: [], status: 'idle' })
    expect(useBookmarkFoldersFor(undefined)).toEqual({
      folders: [],
      status: 'idle'
    })
  })
})

const useBookmarkFoldersFor = (actorId: string | undefined) =>
  renderHook(() => useBookmarkFolders(actorId)).result.current
