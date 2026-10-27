/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import {
  type GalleryHydrationResume,
  useDaySelection
} from '@/lib/components/gallery/useDaySelection'
import type {
  GalleryDayKey,
  GalleryItemEntity
} from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'
import type { GalleryMediaSort } from '@/lib/types/database/gallery'
import { MAX_GALLERY_IDS_OFFSET } from '@/lib/types/database/galleryAlbums'

const DAY: GalleryDayKey = '2025-10-04'
const OTHER_DAY: GalleryDayKey = '2025-10-03'

const dayItem = (mediaId: string, takenAt: string) =>
  buildGalleryItem(mediaId, { takenAt })

interface HarnessProps {
  selected: string[]
  room: number | null
  existingIds: ReadonlySet<string>
  sort: GalleryMediaSort
  resetKey?: string
  ownerKey?: string
  disabled?: boolean
}

// Renders the hook against a selection the host owns: onChange updates the
// prop the hook sees, exactly like a real host's setSelected.
const setup = ({
  selected = [],
  room = null,
  existingIds = new Set<string>(),
  sort = 'taken_desc',
  resetKey,
  ownerKey,
  disabled = false,
  fetchIds = vi.fn(),
  loadItems,
  querySnapshot,
  onItemsLoaded
}: {
  selected?: string[]
  room?: number | null
  existingIds?: ReadonlySet<string>
  sort?: GalleryMediaSort
  resetKey?: string
  ownerKey?: string
  disabled?: boolean
  fetchIds?: (
    dayKey: GalleryDayKey,
    limit: number,
    offset?: number
  ) => Promise<string[]>
  loadItems?: (
    dayKey: GalleryDayKey,
    mediaIds: string[],
    isStale: () => boolean,
    signal?: AbortSignal,
    resume?: GalleryHydrationResume,
    sort?: GalleryMediaSort,
    query?: unknown
  ) => Promise<GalleryItemEntity[]>
  querySnapshot?: () => unknown
  onItemsLoaded?: (items: GalleryItemEntity[]) => void
} = {}) => {
  const state: HarnessProps & { fetchIds: typeof fetchIds } = {
    selected: [...selected],
    room,
    existingIds,
    sort,
    resetKey,
    ownerKey,
    disabled,
    fetchIds
  }
  let rerender!: (props: HarnessProps) => void
  const onChange = vi.fn(
    (change: string[] | ((current: string[]) => string[])) => {
      state.selected =
        typeof change === 'function' ? change(state.selected) : change
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: state.resetKey,
        ownerKey: state.ownerKey,
        disabled: state.disabled
      })
    }
  )
  const hook = renderHook(
    ({
      selected: selection,
      room: roomLeft,
      existingIds: existing,
      sort: sortProp,
      resetKey: key,
      ownerKey: ownerKeyProp,
      disabled: isDisabled
    }) =>
      useDaySelection({
        selected: selection,
        onChange,
        sort: sortProp,
        existingIds: existing,
        room: roomLeft,
        fetchIds,
        loadItems,
        querySnapshot,
        onItemsLoaded,
        resetKey: key,
        ownerKey: ownerKeyProp,
        disabled: isDisabled
      }),
    {
      initialProps: {
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: state.resetKey,
        ownerKey: state.ownerKey,
        disabled: state.disabled
      }
    }
  )
  rerender = hook.rerender as (props: HarnessProps) => void
  return { ...hook, rerender, state, onChange, fetchIds }
}

describe('useDaySelection', () => {
  it('asks for take plus the selection, capped at the album maximum', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2'])
    const { result } = setup({ selected: ['s1', 's2'], room: 2000, fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 4)
    })
    expect(fetchIds).toHaveBeenCalledWith(DAY, 6)

    await act(async () => {
      await result.current.selectDay(DAY, 1998)
    })
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000)
  })

  it('pages All media ids past 2,000 until the final short page', async () => {
    const firstPage = Array.from({ length: 2000 }, (_, index) => `p${index}`)
    const secondPage = Array.from(
      { length: 500 },
      (_, index) => `p${index + 2000}`
    )
    const fetchIds = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
    const { result, state } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 2500)
    })

    expect(fetchIds).toHaveBeenNthCalledWith(1, DAY, 2000, 0)
    expect(fetchIds).toHaveBeenNthCalledWith(2, DAY, 2000, 2000)
    expect(state.selected).toEqual([...firstPage, ...secondPage])
    expect(result.current.toast?.message).toBe(
      'Selected 2,500 photos from Sat 4 Oct 2025'
    )
    expect(result.current.announcement).toBe('Selected 2,500 photos')
  })

  it('stops the All media whole-day read at 25 pages and says so', async () => {
    const page = (offset: number) =>
      Array.from({ length: 2000 }, (_, index) => `p${offset + index}`)
    const fetchIds = vi
      .fn()
      .mockImplementation((_dayKey, _limit, offset = 0) =>
        Promise.resolve(page(offset))
      )
    const { result, state } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 60000)
    })

    expect(fetchIds).toHaveBeenCalledTimes(25)
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, 48000)
    expect(state.selected).toHaveLength(50000)
    expect(result.current.toast?.message).toBe(
      'Selected the first 50,000 photos from Sat 4 Oct 2025'
    )
    expect(result.current.announcement).toBe('Selected 50,000 photos')
  })

  it('continues the whole-day read from the saved offset on the next click', async () => {
    const page = (offset: number) =>
      offset < 60000
        ? Array.from({ length: 2000 }, (_, index) => `p${offset + index}`)
        : []
    const fetchIds = vi
      .fn()
      .mockImplementation((_dayKey, _limit, offset = 0) =>
        Promise.resolve(page(offset))
      )
    const { result, state } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 60000)
    })
    expect(fetchIds).toHaveBeenCalledTimes(25)
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, 48000)
    expect(state.selected).toHaveLength(50000)
    expect(result.current.toast?.message).toBe(
      'Selected the first 50,000 photos from Sat 4 Oct 2025'
    )

    await act(async () => {
      await result.current.selectDay(DAY, 10000)
    })

    // The second click continues at offset 50,000 instead of re-reading
    // from 0, and reads the day to its end (the empty page at 60,000).
    expect(fetchIds).toHaveBeenNthCalledWith(26, DAY, 2000, 50000)
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, 60000)
    expect(fetchIds).toHaveBeenCalledTimes(31)
    expect(state.selected).toHaveLength(60000)
    expect(result.current.toast?.message).toBe(
      'Selected 10,000 photos from Sat 4 Oct 2025'
    )
  })

  it('forgets the whole-day continuation offset when the selection loses ids', async () => {
    const page = (offset: number) =>
      Array.from({ length: 2000 }, (_, index) => `p${offset + index}`)
    const fetchIds = vi
      .fn()
      .mockImplementation((_dayKey, _limit, offset = 0) =>
        Promise.resolve(page(offset))
      )
    const { result, state } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 60000)
    })
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, 48000)
    expect(state.selected).toHaveLength(50000)

    // Undo removes the ids the saved offset skipped.
    await act(async () => {
      result.current.toast?.undo?.()
    })
    expect(state.selected).toEqual([])

    await act(async () => {
      await result.current.selectDay(DAY, 60000)
    })
    // The saved offset assumed the ids before it were still selected; the
    // undo broke that, so the next read starts over from offset 0 instead
    // of skipping the 50,000 photos it already covered.
    expect(fetchIds).toHaveBeenNthCalledWith(26, DAY, 2000, 0)
  })

  it('drops the offset a page-bounded read would save when ids leave the selection mid-read', async () => {
    const page = (offset: number) =>
      Array.from({ length: 2000 }, (_, index) => `p${offset + index}`)
    // The second click's 25th page (offset 98,000) stays pending while the
    // selection loses ids, then settles with a full page: without the
    // generation check it would save offset 100,000 whose invariant (the
    // ids before it are still selected) the undo just broke.
    const lastPage = createDeferred<string[]>()
    const fetchIds = vi
      .fn()
      .mockImplementation((_dayKey, _limit, offset = 0) =>
        offset === 98000 ? lastPage.promise : Promise.resolve(page(offset))
      )
    const { result, state } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 60000)
    })
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, 48000)
    expect(state.selected).toHaveLength(50000)

    let pending!: Promise<void>
    act(() => {
      pending = result.current.selectDay(DAY, 60000)
    })
    // The read resumes at the saved offset 50,000 and pages to its last
    // page before the undo lands.
    expect(fetchIds).toHaveBeenNthCalledWith(26, DAY, 2000, 50000)

    await act(async () => {
      result.current.toast?.undo?.()
    })
    expect(state.selected).toEqual([])

    await act(async () => {
      lastPage.resolve(page(98000))
      await pending
    })
    expect(state.selected).toHaveLength(50000)
    expect(result.current.toast?.message).toBe(
      'Selected the first 100,000 photos from Sat 4 Oct 2025'
    )

    await act(async () => {
      await result.current.selectDay(DAY, 60000)
    })
    // The read that settled after the undo saved nothing: the next click
    // starts over from offset 0 instead of skipping the undone ids.
    expect(fetchIds).toHaveBeenNthCalledWith(51, DAY, 2000, 0)
  })

  it('forgets the whole-day continuation offset on a resetKey change', async () => {
    const page = (offset: number) =>
      Array.from({ length: 2000 }, (_, index) => `p${offset + index}`)
    const fetchIds = vi
      .fn()
      .mockImplementation((_dayKey, _limit, offset = 0) =>
        Promise.resolve(page(offset))
      )
    const { result, state, rerender } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 60000)
    })
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, 48000)

    act(() => {
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: 'next-context',
        ownerKey: state.ownerKey,
        disabled: state.disabled
      })
    })

    await act(async () => {
      await result.current.selectDay(DAY, 10)
    })
    expect(fetchIds).toHaveBeenNthCalledWith(26, DAY, 2000, 0)
  })

  it('exposes the running count of fetched ids across pages', async () => {
    const firstPage = createDeferred<string[]>()
    const secondPage = createDeferred<string[]>()
    const fetchIds = vi
      .fn()
      .mockReturnValueOnce(firstPage.promise)
      .mockReturnValueOnce(secondPage.promise)
    const { result, state } = setup({ fetchIds })

    let pending!: Promise<void>
    act(() => {
      pending = result.current.selectDay(DAY, 2500)
    })
    expect(result.current.busyKey).toBe(DAY)
    expect(result.current.busyCount).toBe(0)

    await act(async () => {
      firstPage.resolve(Array.from({ length: 2000 }, (_, index) => `p${index}`))
      await Promise.resolve()
    })
    expect(result.current.busyKey).toBe(DAY)
    expect(result.current.busyCount).toBe(2000)

    await act(async () => {
      secondPage.resolve(
        Array.from({ length: 500 }, (_, index) => `p${index + 2000}`)
      )
      await pending
    })
    expect(result.current.busyKey).toBeNull()
    expect(result.current.busyCount).toBe(0)
    expect(state.selected).toHaveLength(2500)
  })

  it('ignores a second Select day call while the first request is busy', async () => {
    const ids = createDeferred<string[]>()
    const fetchIds = vi.fn().mockReturnValue(ids.promise)
    const { result } = setup({ fetchIds })
    let first!: Promise<void>

    act(() => {
      first = result.current.selectDay(DAY, 1)
      void result.current.selectDay(OTHER_DAY, 1)
    })

    expect(result.current.busyKey).toBe(DAY)
    expect(fetchIds).toHaveBeenCalledTimes(1)

    await act(async () => {
      ids.resolve(['p1'])
      await first
    })
    expect(fetchIds).toHaveBeenCalledTimes(1)
  })

  it('aborts item hydration when the owner changes', async () => {
    const loaded = createDeferred<GalleryItemEntity[]>()
    const loadItems = vi.fn(
      (
        _key: GalleryDayKey,
        _ids: string[],
        _isStale: () => boolean,
        _signal?: AbortSignal
      ) => loaded.promise
    )
    const onItemsLoaded = vi.fn()
    const fetchIds = vi.fn().mockResolvedValue(['missing'])
    const { result, rerender } = renderHook(
      ({ ownerKey }: { ownerKey: string }) =>
        useDaySelection({
          selected: [],
          onChange: vi.fn(),
          sort: 'taken_desc',
          room: null,
          ownerKey,
          fetchIds,
          loadItems,
          onItemsLoaded
        }),
      { initialProps: { ownerKey: 'owner-a' } }
    )

    await act(async () => {
      await result.current.selectDay(DAY, 1)
    })
    await waitFor(() => expect(loadItems).toHaveBeenCalledOnce())
    const signal = loadItems.mock.calls[0][3]

    rerender({ ownerKey: 'owner-b' })

    expect(signal?.aborted).toBe(true)
    await act(async () => {
      loaded.resolve([dayItem('missing', '2025-10-04T10:00:00Z')])
      await loaded.promise
    })
    expect(onItemsLoaded).not.toHaveBeenCalled()
  })

  it('merges queued day picks with the latest selection in one tick', async () => {
    const ids = createDeferred<string[]>()
    const fetchIds = vi.fn().mockReturnValue(ids.promise)
    const { result } = renderHook(() => {
      const [selected, setSelected] = useState<string[]>([])
      const day = useDaySelection({
        selected,
        onChange: (change: string[] | ((current: string[]) => string[])) => {
          setSelected((current) =>
            typeof change === 'function' ? change(current) : change
          )
        },
        sort: 'taken_desc',
        room: null,
        fetchIds
      })
      return { selected, setSelected, day }
    })

    await act(async () => {
      const pending = result.current.day.selectDay(DAY, 1)
      result.current.setSelected((current) => [...current, 'other-day-pick'])
      ids.resolve(['selected-day-pick'])
      await pending
    })

    expect(result.current.selected).toEqual([
      'other-day-pick',
      'selected-day-pick'
    ])
  })

  it('keeps the plain count when the day comes back under the cap', async () => {
    const ids = Array.from({ length: 1999 }, (_, index) => `p${index}`)
    const fetchIds = vi.fn().mockResolvedValue(ids)
    const { result, state } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 2000)
    })

    expect(state.selected).toEqual(ids)
    expect(result.current.toast?.message).toBe(
      'Selected 1,999 photos from Sat 4 Oct 2025'
    )
    expect(result.current.announcement).toBe('Selected 1,999 photos')
  })

  it('keeps the room message at the cap when a capacity is set', async () => {
    const ids = Array.from({ length: 2000 }, (_, index) => `p${index}`)
    const fetchIds = vi.fn().mockResolvedValue(ids)
    const { result, state } = setup({ room: 5, fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 5)
    })

    expect(state.selected).toEqual(ids.slice(0, 5))
    expect(result.current.toast?.message).toBe(
      'Selected 5 photos from Sat 4 Oct 2025 · the album is full'
    )
    expect(result.current.announcement).toBe(
      'Selected 5 photos, the album is full'
    )
  })

  it('skips selected and existing ids and slices to take', async () => {
    const fetchIds = vi
      .fn()
      .mockResolvedValue(['s1', 'e1', 'p1', 'p2', 'p3', 'p4', 'p5'])
    const { result, state } = setup({
      selected: ['s1'],
      existingIds: new Set(['e1']),
      fetchIds
    })

    await act(async () => {
      await result.current.selectDay(DAY, 3)
    })

    expect(state.selected).toEqual(['s1', 'p1', 'p2', 'p3'])
    expect(result.current.toast?.message).toBe(
      'Selected 3 photos from Sat 4 Oct 2025'
    )
  })

  it('undo removes exactly the added ids and keeps a hand pick made meanwhile', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2', 'p3'])
    const { result, state, onChange } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 2)
    })
    expect(state.selected).toEqual(['p1', 'p2'])

    // A photo picked by hand while the toast is up.
    await act(async () => {
      onChange(['p1', 'p2', 'hand'])
    })

    await act(async () => {
      result.current.toast?.undo?.()
    })

    expect(state.selected).toEqual(['hand'])
  })

  it('ends the toast with the room cap and announces the full album', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2', 'p3', 'p4'])
    const { result, state } = setup({ room: 3, fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 3)
    })

    expect(state.selected).toEqual(['p1', 'p2', 'p3'])
    expect(result.current.toast?.message).toBe(
      'Selected 3 photos from Sat 4 Oct 2025 · the album is full'
    )
    expect(result.current.announcement).toBe(
      'Selected 3 photos, the album is full'
    )
  })

  it('does not say the album is full when the day simply runs out', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2'])
    const { result } = setup({ room: 5, fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 5)
    })

    expect(result.current.toast?.message).toBe(
      'Selected 2 photos from Sat 4 Oct 2025'
    )
    expect(result.current.announcement).toBe('Selected 2 photos')
  })

  it('clears busy before background item hydration finishes', async () => {
    const hydration = createDeferred<GalleryItemEntity[]>()
    const onItemsLoaded = vi.fn()
    const { result, state } = setup({
      fetchIds: vi.fn().mockResolvedValue(['p1']),
      loadItems: () => hydration.promise,
      onItemsLoaded
    })

    let pending!: Promise<void>
    await act(async () => {
      pending = result.current.selectDay(DAY, 1)
      await Promise.resolve()
    })

    expect(state.selected).toEqual(['p1'])
    expect(result.current.busyKey).toBeNull()
    expect(onItemsLoaded).not.toHaveBeenCalled()

    await act(async () => {
      hydration.resolve([dayItem('p1', `${DAY}T09:00:00Z`)])
      await pending
    })
    expect(onItemsLoaded).toHaveBeenCalledWith([
      dayItem('p1', `${DAY}T09:00:00Z`)
    ])
  })

  it('delivers hydrated items when the reset key changes', async () => {
    const hydration = createDeferred<GalleryItemEntity[]>()
    const loadItems = vi.fn(
      (
        _key: GalleryDayKey,
        _ids: string[],
        _isStale: () => boolean,
        _signal?: AbortSignal
      ) => hydration.promise
    )
    const onItemsLoaded = vi.fn()
    const { result, state, rerender } = setup({
      fetchIds: vi.fn().mockResolvedValue(['p1']),
      loadItems,
      onItemsLoaded
    })

    let pending!: Promise<void>
    act(() => {
      pending = result.current.selectDay(DAY, 1)
    })
    await waitFor(() => expect(loadItems).toHaveBeenCalledOnce())
    const signal = loadItems.mock.calls[0][3]

    act(() => {
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: 'new-query',
        ownerKey: state.ownerKey,
        disabled: state.disabled
      })
    })
    expect(signal?.aborted).toBe(false)

    await act(async () => {
      hydration.resolve([dayItem('p1', `${DAY}T09:00:00Z`)])
      await pending
    })

    expect(state.selected).toEqual(['p1'])
    expect(onItemsLoaded).toHaveBeenCalledWith([
      dayItem('p1', `${DAY}T09:00:00Z`)
    ])
  })

  it('retries hydration for selected ids using their remembered day', async () => {
    const item = dayItem('p1', `${DAY}T09:00:00Z`)
    const loadItems = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([item])
    const onItemsLoaded = vi.fn()
    const { result, state } = setup({
      fetchIds: vi.fn().mockResolvedValue(['p1']),
      loadItems,
      onItemsLoaded
    })

    await act(async () => {
      await result.current.selectDay(DAY, 1)
    })
    await waitFor(() => expect(loadItems).toHaveBeenCalledOnce())
    expect(state.selected).toEqual(['p1'])
    expect(onItemsLoaded).not.toHaveBeenCalled()

    act(() => result.current.retryHydration())

    await waitFor(() => expect(onItemsLoaded).toHaveBeenCalledWith([item]))
    expect(loadItems).toHaveBeenNthCalledWith(
      2,
      DAY,
      ['p1'],
      expect.any(Function),
      expect.any(AbortSignal),
      expect.objectContaining({}),
      'taken_desc',
      undefined
    )
  })

  // A host-shaped loadItems: one photo per page, at most two pages per
  // call (the real hosts' 50-page bound, shrunk), reporting the cursor a
  // retry continues from whenever the bound stops it.
  const pagingLoadItems = (dayList: GalleryItemEntity[]) =>
    vi.fn(
      async (
        _key: GalleryDayKey,
        mediaIds: string[],
        _isStale: () => boolean,
        _signal?: AbortSignal,
        resume?: GalleryHydrationResume,
        _sort?: GalleryMediaSort,
        _query?: unknown
      ) => {
        const wanted = new Set(mediaIds)
        const found = new Map<string, GalleryItemEntity>()
        let index = Number(resume?.from ?? 0)
        let pages = 0
        while (
          index < dayList.length &&
          found.size < wanted.size &&
          pages < 2
        ) {
          const item = dayList[index]
          if (wanted.has(item.mediaId)) found.set(item.mediaId, item)
          index += 1
          pages += 1
        }
        if (
          resume &&
          pages === 2 &&
          index < dayList.length &&
          found.size < wanted.size
        ) {
          resume.stoppedAt = String(index)
        }
        return mediaIds.flatMap((id) => {
          const item = found.get(id)
          return item ? [item] : []
        })
      }
    )

  it('resumes hydration from the cursor where the page bound stopped it', async () => {
    const dayList = [
      dayItem('p1', `${DAY}T09:00:00Z`),
      dayItem('f1', `${DAY}T10:00:00Z`),
      dayItem('f2', `${DAY}T11:00:00Z`),
      dayItem('p2', `${DAY}T12:00:00Z`)
    ]
    const loadItems = pagingLoadItems(dayList)
    const onItemsLoaded = vi.fn()
    const { result, state } = setup({
      fetchIds: vi.fn().mockResolvedValue(['p1', 'p2']),
      loadItems,
      onItemsLoaded
    })

    await act(async () => {
      await result.current.selectDay(DAY, 2)
    })
    await waitFor(() => expect(loadItems).toHaveBeenCalledOnce())
    // The first read stops at the page bound after p1, with p2 still
    // missing, and remembers the cursor it stopped at.
    expect(onItemsLoaded).toHaveBeenCalledWith([dayList[0]])
    expect(loadItems.mock.calls[0][4]?.from).toBeUndefined()
    expect(loadItems.mock.calls[0][4]?.stoppedAt).toBe('2')
    expect(state.selected).toEqual(['p1', 'p2'])

    act(() => result.current.retryHydration())

    await waitFor(() =>
      expect(onItemsLoaded).toHaveBeenCalledWith([dayList[3]])
    )
    expect(loadItems).toHaveBeenNthCalledWith(
      2,
      DAY,
      ['p2'],
      expect.any(Function),
      expect.any(AbortSignal),
      expect.objectContaining({ from: '2' }),
      'taken_desc',
      undefined
    )
  })

  it('replays the query a day hydrated under on a retry after the query changes', async () => {
    const dayList = [
      dayItem('f1', `${DAY}T10:00:00Z`),
      dayItem('f2', `${DAY}T11:00:00Z`),
      dayItem('f3', `${DAY}T12:00:00Z`)
    ]
    const loadItems = pagingLoadItems(dayList)
    const querySnapshot = vi.fn(() => ({ species: 'lion' }))
    const { result } = setup({
      fetchIds: vi.fn().mockResolvedValue(['p1']),
      loadItems,
      querySnapshot
    })

    await act(async () => {
      await result.current.selectDay(DAY, 1)
    })
    await waitFor(() => expect(loadItems).toHaveBeenCalledOnce())
    // The first hydration runs under the host's current query and stops
    // at the page bound, saving its cursor.
    expect(loadItems.mock.calls[0][6]).toEqual({ species: 'lion' })
    expect(loadItems.mock.calls[0][4]?.stoppedAt).toBe('2')

    // The host's query changes; the retry still pages the query the
    // day's hydration started under, continuing from the saved cursor.
    querySnapshot.mockReturnValue({ species: 'puffin' })
    act(() => result.current.retryHydration())

    await waitFor(() => expect(loadItems).toHaveBeenCalledTimes(2))
    expect(loadItems.mock.calls[1][6]).toEqual({ species: 'lion' })
    expect(loadItems.mock.calls[1][4]).toEqual(
      expect.objectContaining({ from: '2' })
    )
  })

  it('hydrates a later pick under a new filter from page 1 while the old filter keeps its cursor', async () => {
    const lionList = [
      dayItem('p1', `${DAY}T09:00:00Z`),
      dayItem('f1', `${DAY}T10:00:00Z`),
      dayItem('p2', `${DAY}T12:00:00Z`)
    ]
    const puffinList = [dayItem('q1', `${DAY}T09:30:00Z`)]
    const lists: Record<string, GalleryItemEntity[]> = {
      lion: lionList,
      puffin: puffinList
    }
    // A host-shaped loadItems: pages the list of the query it is called
    // with, at most two pages per call, reporting the cursor a retry
    // continues from whenever the bound stops it.
    const loadItems = vi.fn(
      async (
        _key: GalleryDayKey,
        mediaIds: string[],
        _isStale: () => boolean,
        _signal?: AbortSignal,
        resume?: GalleryHydrationResume,
        _sort?: GalleryMediaSort,
        query?: unknown
      ) => {
        const dayList =
          lists[(query as { species?: string } | undefined)?.species ?? ''] ??
          []
        const wanted = new Set(mediaIds)
        const found = new Map<string, GalleryItemEntity>()
        let index = Number(resume?.from ?? 0)
        let pages = 0
        while (
          index < dayList.length &&
          found.size < wanted.size &&
          pages < 2
        ) {
          const item = dayList[index]
          if (wanted.has(item.mediaId)) found.set(item.mediaId, item)
          index += 1
          pages += 1
        }
        if (
          resume &&
          pages === 2 &&
          index < dayList.length &&
          found.size < wanted.size
        ) {
          resume.stoppedAt = String(index)
        }
        return mediaIds.flatMap((id) => {
          const item = found.get(id)
          return item ? [item] : []
        })
      }
    )
    const querySnapshot = vi.fn(() => ({ species: 'lion' }))
    const onItemsLoaded = vi.fn()
    const { result, state } = setup({
      fetchIds: vi
        .fn()
        .mockResolvedValueOnce(['p1', 'p2'])
        .mockResolvedValueOnce(['q1']),
      loadItems,
      querySnapshot,
      onItemsLoaded
    })

    // Under the lion filter the day hydrates to the page bound, saving
    // the lion entry's cursor with p2 still missing.
    await act(async () => {
      await result.current.selectDay(DAY, 2)
    })
    await waitFor(() => expect(loadItems).toHaveBeenCalledOnce())
    expect(loadItems.mock.calls[0][6]).toEqual({ species: 'lion' })
    expect(loadItems.mock.calls[0][4]?.from).toBeUndefined()
    expect(loadItems.mock.calls[0][4]?.stoppedAt).toBe('2')
    expect(state.selected).toEqual(['p1', 'p2'])

    // The host switches to the puffin filter and the day is selected
    // again: the new pick hydrates under puffin from page 1, never
    // resuming the lion cursor or paging the lion query.
    querySnapshot.mockReturnValue({ species: 'puffin' })
    await act(async () => {
      await result.current.selectDay(DAY, 1)
    })
    await waitFor(() => expect(loadItems).toHaveBeenCalledTimes(2))
    expect(loadItems.mock.calls[1][1]).toEqual(['q1'])
    expect(loadItems.mock.calls[1][4]?.from).toBeUndefined()
    expect(loadItems.mock.calls[1][6]).toEqual({ species: 'puffin' })
    await waitFor(() =>
      expect(onItemsLoaded).toHaveBeenCalledWith([puffinList[0]])
    )

    // Retry loading: the lion pick still missing resumes the lion
    // entry's cursor under the lion query.
    act(() => result.current.retryHydration())

    await waitFor(() => expect(loadItems).toHaveBeenCalledTimes(3))
    expect(loadItems.mock.calls[2][1]).toEqual(['p2'])
    expect(loadItems.mock.calls[2][4]).toEqual(
      expect.objectContaining({ from: '2' })
    )
    expect(loadItems.mock.calls[2][6]).toEqual({ species: 'lion' })
    await waitFor(() =>
      expect(onItemsLoaded).toHaveBeenCalledWith([lionList[2]])
    )
  })

  it('forgets the hydration resume cursor when the owner changes', async () => {
    const dayList = [
      dayItem('p1', `${DAY}T09:00:00Z`),
      dayItem('f1', `${DAY}T10:00:00Z`),
      dayItem('f2', `${DAY}T11:00:00Z`),
      dayItem('p2', `${DAY}T12:00:00Z`)
    ]
    const loadItems = pagingLoadItems(dayList)
    const { result, state, rerender } = setup({
      ownerKey: 'owner-a',
      fetchIds: vi.fn().mockResolvedValue(['p1', 'p2']),
      loadItems
    })

    await act(async () => {
      await result.current.selectDay(DAY, 2)
    })
    await waitFor(() => expect(loadItems).toHaveBeenCalledOnce())
    expect(loadItems.mock.calls[0][4]?.stoppedAt).toBe('2')

    act(() => {
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: state.resetKey,
        ownerKey: 'owner-b',
        disabled: state.disabled
      })
    })
    act(() => result.current.retryHydration())

    await waitFor(() => expect(loadItems).toHaveBeenCalledTimes(2))
    expect(loadItems.mock.calls[1][4]?.from).toBeUndefined()
  })

  it('keeps the selection and feedback when item hydration fails', async () => {
    const { result, state } = setup({
      fetchIds: vi.fn().mockResolvedValue(['p1']),
      loadItems: vi.fn().mockRejectedValue(new Error('Hydration failed'))
    })

    await act(async () => {
      await result.current.selectDay(DAY, 1)
    })

    expect(state.selected).toEqual(['p1'])
    expect(result.current.error).toBeNull()
    expect(result.current.toast?.message).toBe(
      'Selected 1 photo from Sat 4 Oct 2025'
    )
  })

  it('clamps a pending response to the room left when it settles', async () => {
    const deferred = createDeferred<string[]>()
    const { result, state, rerender, onChange } = setup({
      room: 5,
      fetchIds: () => deferred.promise
    })

    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.selectDay(DAY, 5)
    })

    state.selected = ['hand-1', 'hand-2', 'hand-3', 'hand-4', 'hand-5']
    state.room = 0
    rerender({
      selected: state.selected,
      room: state.room,
      existingIds: state.existingIds,
      sort: state.sort,
      resetKey: state.resetKey
    })

    await act(async () => {
      deferred.resolve(['p1', 'p2', 'p3', 'p4', 'p5'])
      await pending
    })

    expect(state.selected).toEqual([
      'hand-1',
      'hand-2',
      'hand-3',
      'hand-4',
      'hand-5'
    ])
    expect(onChange).not.toHaveBeenCalled()
    expect(result.current.toast?.message).toBe('Album full')
    expect(result.current.announcement).toBe('The album is full')
  })

  it('toasts Nothing new without undo when there is nothing to add', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['s1', 'e1'])
    const { result, state } = setup({
      selected: ['s1'],
      existingIds: new Set(['e1']),
      fetchIds
    })

    await act(async () => {
      await result.current.selectDay(DAY, 5)
    })

    expect(state.selected).toEqual(['s1'])
    expect(result.current.toast?.message).toBe(
      'Nothing new to select from Sat 4 Oct 2025'
    )
    expect(result.current.toast?.undo).toBeNull()
    expect(result.current.announcement).toBe('Nothing to change')
  })

  it('toasts Nothing new for an upload day without a from', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['s1'])
    const { result, state } = setup({
      selected: ['s1'],
      fetchIds
    })

    await act(async () => {
      await result.current.selectDay('uploaded:2026-10-24', 5)
    })

    expect(state.selected).toEqual(['s1'])
    expect(result.current.toast?.message).toBe(
      'Nothing new to select among photos uploaded Sat 24 Oct 2026'
    )
    expect(result.current.toast?.undo).toBeNull()
    expect(result.current.announcement).toBe('Nothing to change')
  })

  it('reports a rejected fetch as an error and leaves the selection alone', async () => {
    const fetchIds = vi.fn().mockRejectedValue(new Error('Network down'))
    const { result, state } = setup({
      selected: ['s1'],
      room: 100,
      fetchIds
    })

    await act(async () => {
      await result.current.selectDay(DAY, 5)
    })

    expect(result.current.error).toBe('Network down')
    expect(result.current.toast).toBeNull()
    expect(result.current.busyKey).toBeNull()
    expect(state.selected).toEqual(['s1'])
  })

  it('deselects only the day ids and undo restores them', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2'])
    const { result, state, onChange } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 2)
    })
    await act(async () => {
      result.current.noteItems([
        dayItem('other1', `${OTHER_DAY}T09:00:00Z`),
        dayItem('other2', `${OTHER_DAY}T10:00:00Z`)
      ])
      onChange(['p1', 'p2', 'other1', 'other2'])
    })

    await act(async () => {
      await result.current.deselectDay(DAY)
    })

    expect(state.selected).toEqual(['other1', 'other2'])
    expect(result.current.toast?.message).toBe(
      'Deselected 2 photos from Sat 4 Oct 2025'
    )
    expect(result.current.announcement).toBe('Deselected 2 photos')

    await act(async () => {
      result.current.toast?.undo?.()
    })

    expect(state.selected).toEqual(['other1', 'other2', 'p1', 'p2'])
  })

  it('clamps Deselect day undo to the room left and announces the short restore', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2'])
    const { result, state, onChange, rerender } = setup({
      selected: ['p1', 'p2'],
      room: 2,
      fetchIds
    })

    await act(async () => {
      result.current.noteItems([
        dayItem('p1', `${DAY}T09:00:00Z`),
        dayItem('p2', `${DAY}T10:00:00Z`)
      ])
      await result.current.deselectDay(DAY)
    })
    expect(state.selected).toEqual([])

    act(() => {
      onChange(['other1', 'other2', 'other3'])
      state.room = 1
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: state.resetKey,
        ownerKey: state.ownerKey,
        disabled: state.disabled
      })
    })

    await act(async () => {
      result.current.toast?.undo?.()
    })

    expect(state.selected).toEqual(['other1', 'other2', 'other3', 'p1'])
    expect(result.current.toast?.message).toBe(
      'Restored 1 photo · the album is full'
    )
    expect(result.current.announcement).toBe(
      'Restored 1 photo · the album is full'
    )
  })

  it('ignores a Select day response after the host becomes disabled', async () => {
    const response = createDeferred<string[]>()
    const { result, state, rerender } = setup({
      fetchIds: vi.fn(() => response.promise)
    })

    let pending!: Promise<void>
    act(() => {
      pending = result.current.selectDay(DAY, 1)
    })
    expect(result.current.busyKey).toBe(DAY)

    state.disabled = true
    rerender({
      selected: state.selected,
      room: state.room,
      existingIds: state.existingIds,
      sort: state.sort,
      resetKey: state.resetKey,
      ownerKey: state.ownerKey,
      disabled: true
    })

    await act(async () => {
      response.resolve(['p1'])
      await pending
    })

    expect(state.selected).toEqual([])
    expect(result.current.busyKey).toBeNull()
  })

  it('pickedInDay learns from noteItems and from fetched ids', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2'])
    const { result, onChange } = setup({ fetchIds })

    await act(async () => {
      result.current.noteItems([
        dayItem('n1', `${DAY}T09:00:00Z`),
        dayItem('n2', `${OTHER_DAY}T09:00:00Z`)
      ])
      onChange(['n1', 'n2'])
    })

    expect(result.current.pickedInDay(DAY)).toBe(1)
    expect(result.current.pickedInDay(OTHER_DAY)).toBe(1)

    await act(async () => {
      await result.current.selectDay(DAY, 2)
    })

    expect(result.current.pickedInDay(DAY)).toBe(3)
  })

  it('gives pickedInDay a new identity after noteItems, so memoised headers recompute', async () => {
    const { result } = setup({ selected: ['p1'] })

    // The day map is empty until the host notes its loaded tiles.
    expect(result.current.pickedInDay(DAY)).toBe(0)
    const beforeNoting = result.current.pickedInDay

    await act(async () => {
      result.current.noteItems([dayItem('p1', `${DAY}T09:00:00Z`)])
    })

    // A host keys its day headers on pickedInDay's identity: after a
    // filter or sort reset the re-noted tiles must produce a new one, or
    // the memoised headers keep the counts they computed before (zero).
    expect(result.current.pickedInDay).not.toBe(beforeNoting)
    expect(result.current.pickedInDay(DAY)).toBe(1)
  })

  it('exposes busyKey while the fetch is pending', async () => {
    const deferred = createDeferred<string[]>()
    const fetchIds = vi.fn().mockReturnValue(deferred.promise)
    const { result } = setup({ fetchIds })

    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.selectDay(DAY, 2)
    })
    expect(result.current.busyKey).toBe(DAY)

    await act(async () => {
      deferred.resolve(['p1'])
      await pending
    })
    expect(result.current.busyKey).toBeNull()
  })

  it('does not call the host after unmount when a request settles', async () => {
    const deferred = createDeferred<string[]>()
    const { result, unmount, onChange } = setup({
      fetchIds: () => deferred.promise
    })

    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.selectDay(DAY, 2)
    })
    unmount()

    await act(async () => {
      deferred.resolve(['p1', 'p2'])
      await pending
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores a newer day request until the current request settles', async () => {
    const oldRequest = createDeferred<string[]>()
    const fetchIds = vi.fn().mockReturnValueOnce(oldRequest.promise)
    const { result } = setup({ fetchIds })

    let oldPending: Promise<void> | null = null
    act(() => {
      oldPending = result.current.selectDay(DAY, 1)
    })
    act(() => {
      void result.current.selectDay(OTHER_DAY, 1)
    })
    expect(result.current.busyKey).toBe(DAY)
    expect(fetchIds).toHaveBeenCalledTimes(1)

    await act(async () => {
      oldRequest.resolve(['old'])
      await oldPending
    })
    expect(result.current.busyKey).toBeNull()
    expect(fetchIds).toHaveBeenCalledTimes(1)
  })

  it('clears the toast on dismissToast', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1'])
    const { result } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 1)
    })
    expect(result.current.toast).not.toBeNull()

    act(() => {
      result.current.dismissToast()
    })
    expect(result.current.toast).toBeNull()
  })

  it('ignores a fetch that settles after a resetKey change', async () => {
    const deferred = createDeferred<string[]>()
    const fetchIds = vi.fn().mockReturnValue(deferred.promise)
    const { result, state, rerender } = setup({ fetchIds })

    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.selectDay(DAY, 2)
    })
    expect(result.current.busyKey).toBe(DAY)

    act(() => {
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: 'next-context'
      })
    })
    expect(result.current.busyKey).toBeNull()
    expect(result.current.toast).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.announcement).toBe('')

    await act(async () => {
      deferred.resolve(['p1', 'p2'])
      await pending
    })

    expect(state.selected).toEqual([])
    expect(result.current.busyKey).toBeNull()
    expect(result.current.toast).toBeNull()
  })

  it('clears the day-of entries learned from fetched ids on a resetKey change', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2'])
    const { result, state, rerender } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 2)
    })
    expect(state.selected).toEqual(['p1', 'p2'])
    expect(result.current.pickedInDay(DAY)).toBe(2)

    act(() => {
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: 'next-context'
      })
    })

    // The selection itself is the host's; the day knowledge is the current
    // context's only.
    expect(state.selected).toEqual(['p1', 'p2'])
    expect(result.current.pickedInDay(DAY)).toBe(0)
  })

  it('does not count picks noted under a previous query after a resetKey change', async () => {
    // Five photos picked under no filter, then the filter changes: the
    // picks stay, but nothing on screen is picked, so the day must not
    // report them (the host re-notes the new query's items as they load).
    const fetchIds = vi.fn().mockResolvedValue([])
    const { result, state, onChange, rerender } = setup({ fetchIds })

    await act(async () => {
      result.current.noteItems([
        dayItem('n1', `${DAY}T09:00:00Z`),
        dayItem('n2', `${DAY}T09:30:00Z`),
        dayItem('n3', `${DAY}T10:00:00Z`),
        dayItem('n4', `${DAY}T10:30:00Z`),
        dayItem('n5', `${DAY}T11:00:00Z`)
      ])
      onChange(['n1', 'n2', 'n3', 'n4', 'n5'])
    })
    expect(result.current.pickedInDay(DAY)).toBe(5)

    act(() => {
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: 'species:puffin'
      })
    })

    expect(state.selected).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
    expect(result.current.pickedInDay(DAY)).toBe(0)
  })

  it('toasts the upload day of an upload-day group without a from', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['u1', 'u2'])
    const { result, state } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay('uploaded:2026-10-24', 2)
    })

    expect(state.selected).toEqual(['u1', 'u2'])
    expect(result.current.toast?.message).toBe(
      'Selected 2 photos uploaded Sat 24 Oct 2026'
    )
  })

  it('retries the last failed selectDay with the same key and take', async () => {
    const fetchIds = vi.fn().mockRejectedValueOnce(new Error('Network down'))
    fetchIds.mockResolvedValueOnce(['p1', 'p2'])
    const { result, state } = setup({ selected: ['s1'], room: 100, fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 4)
    })
    expect(result.current.error).toBe('Network down')
    expect(fetchIds).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.retry()
    })

    expect(fetchIds).toHaveBeenCalledTimes(2)
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 5)
    expect(state.selected).toEqual(['s1', 'p1', 'p2'])
    expect(result.current.error).toBeNull()
  })

  it('deselects the day the server read returns after a filter change', async () => {
    // Select day picks three photos; a filter change clears the learned
    // days and only one tile reloads, so the day map alone would miss two.
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2', 'p3'])
    const { result, state, rerender } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay(DAY, 3)
    })
    expect(state.selected).toEqual(['p1', 'p2', 'p3'])

    act(() => {
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: state.sort,
        resetKey: 'species:puffin'
      })
    })
    await act(async () => {
      result.current.noteItems([dayItem('p1', `${DAY}T09:00:00Z`)])
    })
    expect(result.current.pickedInDay(DAY)).toBe(1)

    await act(async () => {
      await result.current.deselectDay(DAY)
    })

    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, 0)
    expect(state.selected).toEqual([])
    expect(result.current.toast?.message).toBe(
      'Deselected 3 photos from Sat 4 Oct 2025'
    )

    await act(async () => {
      result.current.toast?.undo?.()
    })
    expect(state.selected).toEqual(['p1', 'p2', 'p3'])
  })

  it('deselects every id of a day longer than one whole-day read', async () => {
    // An 80,000-photo day spans two 25-page reads; Deselect day pages
    // through both instead of stopping at the first read's 50,000 ids.
    const page = (offset: number) =>
      offset < 80000
        ? Array.from({ length: 2000 }, (_, index) => `p${offset + index}`)
        : []
    const fetchIds = vi
      .fn()
      .mockImplementation((_dayKey, _limit, offset = 0) =>
        Promise.resolve(page(offset))
      )
    const selected = Array.from({ length: 80000 }, (_, index) => `p${index}`)
    const { result, state } = setup({ selected, fetchIds })

    await act(async () => {
      await result.current.deselectDay(DAY)
    })

    expect(fetchIds).toHaveBeenNthCalledWith(25, DAY, 2000, 48000)
    expect(fetchIds).toHaveBeenNthCalledWith(26, DAY, 2000, 50000)
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, 80000)
    expect(fetchIds).toHaveBeenCalledTimes(41)
    expect(state.selected).toEqual([])
    expect(result.current.toast?.message).toBe(
      'Deselected 80,000 photos from Sat 4 Oct 2025'
    )

    await act(async () => {
      result.current.toast?.undo?.()
    })
    expect(state.selected).toEqual(selected)
  })

  it('deselects the picker day with one request capped at the album maximum', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['p1', 'p2'])
    const { result, state } = setup({
      selected: ['p1', 'p2'],
      room: 2000,
      fetchIds
    })

    await act(async () => {
      result.current.noteItems([
        dayItem('p1', `${DAY}T09:00:00Z`),
        dayItem('p2', `${DAY}T10:00:00Z`)
      ])
      await result.current.deselectDay(DAY)
    })

    expect(fetchIds).toHaveBeenCalledWith(DAY, 2000)
    expect(state.selected).toEqual([])
  })

  it('keeps Deselect day out while a Select day read is busy', async () => {
    const ids = createDeferred<string[]>()
    const fetchIds = vi.fn().mockReturnValue(ids.promise)
    const { result, state } = setup({ fetchIds })

    let pending!: Promise<void>
    act(() => {
      pending = result.current.selectDay(DAY, 1)
    })
    act(() => {
      void result.current.deselectDay(DAY)
    })
    expect(fetchIds).toHaveBeenCalledTimes(1)

    await act(async () => {
      ids.resolve(['p1'])
      await pending
    })
    expect(state.selected).toEqual(['p1'])
  })

  it('reports a failed Deselect day as an error and retries it', async () => {
    const fetchIds = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce(['p1'])
    const { result, state } = setup({
      selected: ['p1'],
      room: 2000,
      fetchIds
    })

    await act(async () => {
      result.current.noteItems([dayItem('p1', `${DAY}T09:00:00Z`)])
      await result.current.deselectDay(DAY)
    })
    expect(result.current.error).toBe('Network down')
    expect(state.selected).toEqual(['p1'])

    await act(async () => {
      result.current.retry()
    })

    expect(fetchIds).toHaveBeenCalledTimes(2)
    expect(state.selected).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('toasts the upload day of a deselected upload-day group without a from', async () => {
    const fetchIds = vi.fn().mockResolvedValue(['u1', 'u2'])
    const { result, state } = setup({ fetchIds })

    await act(async () => {
      await result.current.selectDay('uploaded:2026-10-24', 2)
    })
    await act(async () => {
      await result.current.deselectDay('uploaded:2026-10-24')
    })

    expect(state.selected).toEqual([])
    expect(result.current.toast?.message).toBe(
      'Deselected 2 photos uploaded Sat 24 Oct 2026'
    )
  })

  it('hydrates a retry with the sort the pick was selected under', async () => {
    const loadItems = vi.fn().mockResolvedValue([])
    const { result, state, rerender } = setup({
      fetchIds: vi.fn().mockResolvedValue(['p1']),
      loadItems
    })

    await act(async () => {
      await result.current.selectDay(DAY, 1)
    })
    await waitFor(() => expect(loadItems).toHaveBeenCalledOnce())

    // The owner switches to Recently uploaded; the pick keeps its dated
    // day key, so its hydration must keep the sort it was selected under.
    act(() => {
      rerender({
        selected: state.selected,
        room: state.room,
        existingIds: state.existingIds,
        sort: 'uploaded',
        resetKey: 'sort:uploaded'
      })
    })

    act(() => result.current.retryHydration())

    await waitFor(() => expect(loadItems).toHaveBeenCalledTimes(2))
    expect(loadItems).toHaveBeenNthCalledWith(
      2,
      DAY,
      ['p1'],
      expect.any(Function),
      expect.any(AbortSignal),
      expect.objectContaining({}),
      'taken_desc',
      undefined
    )
  })

  it('never pages a whole-day read past the route offset maximum', async () => {
    const dayIds = Array.from({ length: 102001 }, (_, index) => `p${index}`)
    const fetchIds = vi
      .fn()
      .mockImplementation((_dayKey, _limit, offset = 0) =>
        Promise.resolve(dayIds.slice(offset, offset + 2000))
      )
    const { result, state } = setup({ fetchIds })

    // Three clicks walk the continuation to the route's offset maximum.
    for (let click = 0; click < 3; click += 1) {
      await act(async () => {
        await result.current.selectDay(DAY, 60000)
      })
    }
    // The third click reads the last reachable page with the honest toast.
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, MAX_GALLERY_IDS_OFFSET)
    expect(result.current.toast?.message).toBe(
      'Selected the first 102,000 photos from Sat 4 Oct 2025'
    )
    expect(state.selected).toHaveLength(102000)

    const callsAtTheOffsetLimit = fetchIds.mock.calls.filter(
      (call) => call[2] === MAX_GALLERY_IDS_OFFSET
    ).length
    await act(async () => {
      await result.current.selectDay(DAY, 60000)
    })
    for (const call of fetchIds.mock.calls) {
      expect(call[2] ?? 0).toBeLessThanOrEqual(MAX_GALLERY_IDS_OFFSET)
    }
    expect(fetchIds).toHaveBeenCalledTimes(51)
    expect(
      fetchIds.mock.calls.filter((call) => call[2] === MAX_GALLERY_IDS_OFFSET)
    ).toHaveLength(callsAtTheOffsetLimit)
    expect(fetchIds).toHaveBeenLastCalledWith(DAY, 2000, MAX_GALLERY_IDS_OFFSET)
    expect(result.current.toast?.message).toBe(
      'Nothing more can be selected in one go from Sat 4 Oct 2025'
    )
  })

  it('toasts the exhausted marker with the upload day phrase', async () => {
    const dayIds = Array.from({ length: 102001 }, (_, index) => `p${index}`)
    const fetchIds = vi
      .fn()
      .mockImplementation((_dayKey, _limit, offset = 0) =>
        Promise.resolve(dayIds.slice(offset, offset + 2000))
      )
    const { result } = setup({ fetchIds })
    const key: GalleryDayKey = 'uploaded:2026-10-24'

    // Three clicks walk the continuation to the route's offset maximum.
    for (let click = 0; click < 3; click += 1) {
      await act(async () => {
        await result.current.selectDay(key, 60000)
      })
    }
    expect(fetchIds).toHaveBeenLastCalledWith(key, 2000, MAX_GALLERY_IDS_OFFSET)

    await act(async () => {
      await result.current.selectDay(key, 60000)
    })
    expect(result.current.toast?.message).toBe(
      'Nothing more can be selected in one go among photos uploaded Sat 24 Oct 2026'
    )
  })
})
