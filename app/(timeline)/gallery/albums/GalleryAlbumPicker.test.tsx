/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { useState } from 'react'

import { GalleryAlbumPicker } from '@/app/(timeline)/gallery/albums/GalleryAlbumPicker'
import {
  countGalleryMedia,
  getGalleryMedia,
  getGalleryMediaFacets,
  getGalleryMediaIds
} from '@/lib/client'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryMediaFilterBarProps } from '@/lib/components/gallery/filters/GalleryMediaFilterBar'
import type { GalleryMediaFilterEmptyProps } from '@/lib/components/gallery/filters/GalleryMediaFilterEmpty'
import {
  EMPTY_GALLERY_FILTERS,
  type GalleryMediaFilterState,
  clearGalleryFilters,
  setGalleryFilter
} from '@/lib/components/gallery/filters/galleryMediaFilterState'
import type {
  GalleryItemEntity,
  GalleryMediaFacetsResponse
} from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'

vi.mock('@/lib/client', () => ({
  getGalleryMedia: vi.fn(),
  countGalleryMedia: vi.fn(),
  getGalleryMediaFacets: vi.fn(),
  getGalleryMediaIds: vi.fn()
}))

vi.mock('@/lib/components/gallery/filters/GalleryMediaFilterBar', () => ({
  GalleryMediaFilterBar: ({
    filters,
    onChange,
    total,
    inAlbumTotal,
    countDraft
  }: GalleryMediaFilterBarProps) => (
    <div data-testid="mock-filter-bar">
      <span data-testid="filter-sort">{filters.sort}</span>
      <span data-testid="filter-not-in-album">
        {filters.notInAlbum ? 'true' : 'false'}
      </span>
      <span data-testid="filter-total">{total ?? 'null'}</span>
      <span data-testid="filter-in-album-total">{inAlbumTotal ?? 'null'}</span>
      <button
        type="button"
        onClick={() =>
          onChange(setGalleryFilter(filters, 'species', 'sci:alcedo atthis'))
        }
      >
        Set species
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({
            ...filters,
            notInAlbum: !filters.notInAlbum
          })
        }
      >
        Toggle not in album
      </button>
      <button
        type="button"
        onClick={() => onChange({ ...filters, sort: 'uploaded' })}
      >
        Set sort uploaded
      </button>
      <button
        type="button"
        onClick={() => onChange({ ...filters, sort: 'taken_desc' })}
      >
        Set sort taken_desc
      </button>
      {countDraft ? (
        <button
          type="button"
          onClick={async () => {
            const count = await countDraft(filters)
            const el = document.getElementById('count-draft-result')
            if (el) el.textContent = String(count)
          }}
        >
          Call countDraft
        </button>
      ) : null}
    </div>
  )
}))

vi.mock('@/lib/components/gallery/filters/GalleryMediaFilterEmpty', () => ({
  GalleryMediaFilterEmpty: ({
    filters,
    onChange
  }: GalleryMediaFilterEmptyProps) => (
    <div data-testid="filter-empty">
      <span>No matching photos</span>
      <button
        type="button"
        onClick={() => onChange(clearGalleryFilters(filters))}
      >
        Reset filters
      </button>
    </div>
  )
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>
}))

const media = vi.mocked(getGalleryMedia)
const countMedia = vi.mocked(countGalleryMedia)
const facetsMock = vi.mocked(getGalleryMediaFacets)
const mediaIds = vi.mocked(getGalleryMediaIds)

const named = (
  id: string,
  name: string,
  overrides: Partial<GalleryItemEntity> = {}
) =>
  buildGalleryItem(id, {
    attachment: { ...buildGalleryItem(id).attachment, name },
    ...overrides
  })

const Harness = ({
  capacity = 2000,
  existingIds,
  initialSelected = [],
  seedItems,
  onFirstItemChange,
  columns,
  albumId,
  initialFilters,
  onItemsLoaded,
  disabled = false
}: {
  capacity?: number
  existingIds?: string[]
  initialSelected?: string[]
  seedItems?: GalleryItemEntity[]
  onFirstItemChange?: (item: GalleryItemEntity | null) => void
  columns?: 4 | 5
  albumId?: string
  initialFilters?: GalleryMediaFilterState
  onItemsLoaded?: (items: GalleryItemEntity[]) => void
  disabled?: boolean
}) => {
  const [selected, setSelected] = useState<string[]>(initialSelected)
  return (
    <>
      <GalleryAlbumPicker
        ownerId="owner"
        selected={selected}
        onChange={setSelected}
        onFirstItemChange={onFirstItemChange}
        capacity={capacity}
        existingIds={existingIds}
        seedItems={seedItems}
        columns={columns}
        albumId={albumId}
        initialFilters={initialFilters}
        onItemsLoaded={onItemsLoaded}
        disabled={disabled}
      />
      <div data-testid="selected">{selected.join(',')}</div>
    </>
  )
}

describe('GalleryAlbumPicker', () => {
  let mockObserverCallback:
    ((entries: IntersectionObserverEntry[]) => void) | null = null

  beforeEach(() => {
    mockObserverCallback = null
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: class {
        constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
          mockObserverCallback = callback
        }
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    })

    media.mockReset()
    countMedia.mockReset()
    facetsMock.mockReset()
    mediaIds.mockReset()
    facetsMock.mockResolvedValue({
      species: [],
      places: [],
      dates: [],
      activities: []
    } as unknown as GalleryMediaFacetsResponse)
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(globalThis, 'IntersectionObserver')
  })

  it('first request sends sort=taken_desc, show=all, limit 60', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron')],
      nextCursor: null,
      nextMaxId: null
    })
    render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })
    expect(media).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({
        sort: 'taken_desc',
        show: 'all',
        limit: 60
      })
    )
  })

  it('restarts with the new query and drops a slow older answer on filter change', async () => {
    const slowFirst = createDeferred<{
      items: GalleryItemEntity[]
      nextCursor: string | null
      nextMaxId: string | null
    }>()
    media.mockImplementationOnce(() => slowFirst.promise)

    render(<Harness />)

    // Second call answers quickly with a new item
    media.mockResolvedValueOnce({
      items: [named('2', 'Robin')],
      nextCursor: null,
      nextMaxId: null
    })

    // Trigger filter change before slowFirst finishes
    fireEvent.click(screen.getByRole('button', { name: 'Set species' }))

    await screen.findByRole('button', { name: /Select Robin/ })

    // Now slowFirst finishes
    await act(async () => {
      slowFirst.resolve({
        items: [named('1', 'Heron')],
        nextCursor: null,
        nextMaxId: null
      })
    })

    // The slow older answer must be dropped: Robin remains, Heron is NOT present
    expect(
      screen.queryByRole('button', { name: /Select Heron/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Select Robin/ })
    ).toBeInTheDocument()
  })

  it('toggle sends show=not_in_album and refetches facets', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron')],
      nextCursor: null,
      nextMaxId: null
    })

    render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })
    expect(facetsMock).toHaveBeenCalledWith({ show: 'all' })

    fireEvent.click(screen.getByRole('button', { name: 'Toggle not in album' }))

    await waitFor(() => {
      expect(media).toHaveBeenLastCalledWith(
        'owner',
        expect.objectContaining({ show: 'not_in_album' })
      )
      expect(facetsMock).toHaveBeenLastCalledWith({ show: 'not_in_album' })
    })
  })

  it('uses nextCursor for date sort paging and nextMaxId/maxId for uploaded sort paging', async () => {
    // 1. Date sort paging with cursor
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextCursor: 'cursor-date-1',
        nextMaxId: null
      })
      .mockResolvedValueOnce({
        items: [named('2', 'Robin')],
        nextCursor: null,
        nextMaxId: null
      })

    render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })

    await waitFor(() => expect(mockObserverCallback).not.toBeNull())
    act(() => {
      mockObserverCallback!([
        { isIntersecting: true } as IntersectionObserverEntry
      ])
    })

    await screen.findByRole('button', { name: /Select Robin/ })
    expect(media).toHaveBeenLastCalledWith(
      'owner',
      expect.objectContaining({ cursor: 'cursor-date-1', sort: 'taken_desc' })
    )

    // 2. Switch to uploaded sort and page with maxId
    media
      .mockResolvedValueOnce({
        items: [named('3', 'Swan')],
        nextMaxId: 'max-id-1',
        nextCursor: null
      })
      .mockResolvedValueOnce({
        items: [named('4', 'Owl')],
        nextMaxId: null,
        nextCursor: null
      })

    fireEvent.click(screen.getByRole('button', { name: 'Set sort uploaded' }))
    await screen.findByRole('button', { name: /Select Swan/ })

    act(() => {
      mockObserverCallback!([
        { isIntersecting: true } as IntersectionObserverEntry
      ])
    })

    await screen.findByRole('button', { name: /Select Owl/ })
    expect(media).toHaveBeenLastCalledWith(
      'owner',
      expect.objectContaining({ maxId: 'max-id-1', sort: 'uploaded' })
    )
  })

  it('preserves selection and cover item when filters change', async () => {
    const onFirstItemChange = vi.fn()
    media.mockResolvedValueOnce({
      items: [named('1', 'Heron')],
      nextCursor: null,
      nextMaxId: null
    })

    render(<Harness onFirstItemChange={onFirstItemChange} />)
    const heron = await screen.findByRole('button', { name: /Select Heron/ })
    fireEvent.click(heron)

    expect(screen.getByTestId('selected')).toHaveTextContent('1')
    expect(onFirstItemChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaId: '1' })
    )

    // Filter changes to something that returns a different item
    media.mockResolvedValueOnce({
      items: [named('2', 'Robin')],
      nextCursor: null,
      nextMaxId: null
    })

    fireEvent.click(screen.getByRole('button', { name: 'Set species' }))
    await screen.findByRole('button', { name: /Select Robin/ })

    // Selection 1 remains
    expect(screen.getByTestId('selected')).toHaveTextContent('1')
    // Cover item is still Heron because it was kept in seen.current
    expect(onFirstItemChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaId: '1' })
    )
  })

  it('passes total and inAlbumTotal to the filter bar, passing albumId only when supplied', async () => {
    media.mockResolvedValueOnce({
      items: [named('1', 'Heron')],
      total: 50,
      inAlbumTotal: 12,
      nextCursor: null,
      nextMaxId: null
    })

    const { rerender } = render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })

    expect(screen.getByTestId('filter-total')).toHaveTextContent('50')
    expect(screen.getByTestId('filter-in-album-total')).toHaveTextContent('12')
    expect(media.mock.calls[0][1]).not.toHaveProperty('albumId')

    // When albumId is supplied
    media.mockResolvedValueOnce({
      items: [named('1', 'Heron')],
      total: 8,
      inAlbumTotal: 2,
      nextCursor: null,
      nextMaxId: null
    })

    rerender(<Harness albumId="test-album-id" />)
    await waitFor(() => {
      expect(media).toHaveBeenLastCalledWith(
        'owner',
        expect.objectContaining({ albumId: 'test-album-id' })
      )
    })
    expect(screen.getByTestId('filter-total')).toHaveTextContent('8')
    expect(screen.getByTestId('filter-in-album-total')).toHaveTextContent('2')
  })

  it('renders "No photos yet" when library is empty without filters', async () => {
    media.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      nextMaxId: null,
      total: 0
    })

    render(<Harness />)
    expect(await screen.findByText('No photos yet')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to All media' })
    ).toHaveAttribute('href', '/gallery/media')
    expect(screen.queryByTestId('filter-empty')).not.toBeInTheDocument()
  })

  it('renders GalleryMediaFilterEmpty when filters are active and no items match', async () => {
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextCursor: null,
        nextMaxId: null
      })
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        nextMaxId: null,
        total: 0
      })

    render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })

    fireEvent.click(screen.getByRole('button', { name: 'Set species' }))
    expect(await screen.findByTestId('filter-empty')).toBeInTheDocument()
    expect(screen.queryByText('No photos yet')).not.toBeInTheDocument()
  })

  it('shows caption "Uploaded …" for dateless photos on the tile', async () => {
    media.mockResolvedValueOnce({
      items: [
        named('1', 'Heron', {
          takenAt: null,
          uploadedAt: '2025-03-14T10:00:00Z'
        })
      ],
      nextCursor: null,
      nextMaxId: null
    })

    render(<Harness />)
    expect(
      await screen.findByRole('heading', {
        level: 3,
        name: /Uploaded Fri 14 Mar 2025/
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /uploaded 14 Mar 2025/ })
    ).toBeInTheDocument()
  })

  it('never renders a "Load more photos" button', async () => {
    media.mockResolvedValueOnce({
      items: [named('1', 'Heron')],
      nextCursor: 'cur-1',
      nextMaxId: null
    })

    render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })
    expect(
      screen.queryByRole('button', { name: /Load more photos/i })
    ).not.toBeInTheDocument()
  })

  it('selects all shown and clears selection properly', async () => {
    media.mockResolvedValueOnce({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextCursor: null,
      nextMaxId: null
    })

    render(<Harness existingIds={['2']} capacity={5} />)
    await screen.findByRole('button', { name: /Select Heron/ })

    const selectAllBtn = screen.getByRole('button', {
      name: 'Select all shown'
    })
    expect(selectAllBtn).toBeEnabled()

    fireEvent.click(selectAllBtn)
    expect(screen.getByTestId('selected')).toHaveTextContent('1,3')
    expect(selectAllBtn).toBeDisabled()

    const clearBtn = screen.getByRole('button', { name: 'Clear selection' })
    fireEvent.click(clearBtn)
    expect(screen.getByTestId('selected')).toHaveTextContent('')
    expect(selectAllBtn).toBeEnabled()
  })

  it('countDraft calls countGalleryMedia with current filters and albumId', async () => {
    media.mockResolvedValueOnce({
      items: [named('1', 'Heron')],
      nextCursor: null,
      nextMaxId: null
    })
    countMedia.mockResolvedValueOnce(25)

    render(
      <>
        <Harness albumId="album-xyz" />
        <div id="count-draft-result" />
      </>
    )
    await screen.findByRole('button', { name: /Select Heron/ })

    const callDraftBtn = screen.getByRole('button', { name: 'Call countDraft' })
    fireEvent.click(callDraftBtn)

    await waitFor(() => {
      expect(countMedia).toHaveBeenCalledWith(
        'owner',
        expect.objectContaining({
          albumId: 'album-xyz',
          show: 'all'
        })
      )
      expect(document.getElementById('count-draft-result')).toHaveTextContent(
        '25'
      )
    })
  })

  it('knows the cover of a preselected photo that is not in the loaded pages', async () => {
    media.mockResolvedValue({
      items: [named('2', 'Robin')],
      nextCursor: null,
      nextMaxId: null
    })
    const onFirstItemChange = vi.fn()
    const seed = named('9', 'Heron')
    render(
      <Harness
        initialSelected={['9']}
        seedItems={[seed]}
        onFirstItemChange={onFirstItemChange}
      />
    )
    await screen.findByRole('button', {
      name: /Select Robin/
    })

    expect(onFirstItemChange).toHaveBeenLastCalledWith(seed)
  })

  it('shows photos already in the album as such and never picks them', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextCursor: null,
      nextMaxId: null
    })
    render(<Harness existingIds={['2']} />)

    const member = await screen.findByRole('button', {
      name: /Robin.*already in the album/
    })
    expect(member).toHaveAttribute('aria-disabled', 'true')
    expect(member).not.toBeDisabled()
    expect(member).toHaveTextContent('In album')

    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('1,3')
  })

  it('never toggles an in-album tile by click, Space or Enter', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin')],
      nextCursor: null,
      nextMaxId: null
    })
    render(<Harness existingIds={['2']} />)

    const member = await screen.findByRole('button', {
      name: /Robin.*already in the album/
    })
    expect(member).toHaveAttribute('aria-disabled', 'true')
    expect(member).not.toBeDisabled()

    fireEvent.click(member)
    fireEvent.keyDown(member, { key: ' ' })
    fireEvent.keyDown(member, { key: 'Enter' })
    expect(screen.getByTestId('selected')).toHaveTextContent('')
  })

  it('never toggles a blocked tile (the album is full) by click, Space or Enter', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextCursor: null,
      nextMaxId: null
    })
    render(<Harness capacity={1} initialSelected={['1']} />)

    const blocked = await screen.findByRole('button', {
      name: /Select Robin/
    })
    expect(blocked).toHaveAttribute('aria-disabled', 'true')
    expect(blocked).not.toBeDisabled()

    fireEvent.click(blocked)
    fireEvent.keyDown(blocked, { key: ' ' })
    fireEvent.keyDown(blocked, { key: 'Enter' })
    expect(screen.getByTestId('selected')).toHaveTextContent('1')
  })

  it('shows a load failure on initial load and retries', async () => {
    media
      .mockRejectedValueOnce(new Error('Initial boom'))
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextCursor: null,
        nextMaxId: null
      })
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Initial boom')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('button', { name: /Select Heron/ })
    ).toBeInTheDocument()
  })

  it('shows Try again after page 2 failure and retries with the same cursor', async () => {
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextCursor: 'cur-page-2',
        nextMaxId: null
      })
      .mockRejectedValueOnce(new Error('Network error on page 2'))

    render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })

    await waitFor(() => expect(mockObserverCallback).not.toBeNull())
    act(() => {
      mockObserverCallback!([
        { isIntersecting: true } as IntersectionObserverEntry
      ])
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Network error on page 2'
    )
    const tryAgain = screen.getByRole('button', { name: 'Try again' })
    expect(tryAgain).toBeInTheDocument()

    media.mockResolvedValueOnce({
      items: [named('2', 'Robin')],
      nextCursor: null,
      nextMaxId: null
    })

    fireEvent.click(tryAgain)

    expect(media).toHaveBeenLastCalledWith(
      'owner',
      expect.objectContaining({ cursor: 'cur-page-2', show: 'all' })
    )
    expect(
      await screen.findByRole('button', { name: /Select Robin/ })
    ).toBeInTheDocument()
  })

  it('clears the old query and retries a failed restart as a restart, not with the old cursor', async () => {
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextCursor: 'old-cursor',
        nextMaxId: null
      })
      .mockRejectedValueOnce(new Error('Restart boom'))
      .mockResolvedValueOnce({
        items: [named('2', 'Robin')],
        nextCursor: null,
        nextMaxId: null
      })
    render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })

    fireEvent.click(screen.getByRole('button', { name: 'Set species' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Restart boom')
    expect(
      screen.queryByRole('button', { name: /Select Heron/ })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('button', { name: /Select Robin/ })
    ).toBeInTheDocument()
    const retry = media.mock.calls[2][1]!
    expect(retry.cursor).toBeUndefined()
    expect(retry).toMatchObject({ includeTotal: true })
  })

  it('drops the previous totals when a restart fails', async () => {
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextCursor: null,
        nextMaxId: null,
        total: 50,
        inAlbumTotal: 12
      })
      .mockRejectedValueOnce(new Error('Restart boom'))
    render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })
    expect(screen.getByTestId('filter-total')).toHaveTextContent('50')

    fireEvent.click(screen.getByRole('button', { name: 'Set species' }))
    await screen.findByRole('alert')
    expect(screen.getByTestId('filter-total')).toHaveTextContent('null')
    expect(screen.getByTestId('filter-in-album-total')).toHaveTextContent(
      'null'
    )
  })

  it('does not flash "No photos yet" while clearing the last filter loads', async () => {
    const slow = createDeferred<{
      items: GalleryItemEntity[]
      nextCursor: string | null
      nextMaxId: string | null
    }>()
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextCursor: null,
        nextMaxId: null
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null, nextMaxId: null })
      .mockImplementationOnce(() => slow.promise)
    render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })
    fireEvent.click(screen.getByRole('button', { name: 'Set species' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reset filters' })
    )
    expect(screen.queryByText('No photos yet')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-filter-bar')).toBeInTheDocument()
    await act(async () => {
      slow.resolve({ items: [], nextCursor: null, nextMaxId: null })
    })
    expect(await screen.findByText('No photos yet')).toBeInTheDocument()
  })

  it('scrolls the picker back to the start when a filter changes', async () => {
    media.mockResolvedValue({ items: [], nextCursor: null, nextMaxId: null })
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    // The bar is above the viewport, so it has to scroll back.
    const rectSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: -100 } as DOMRect)
    try {
      media.mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextCursor: null,
        nextMaxId: null
      })
      render(<Harness />)
      await screen.findByRole('button', { name: /Select Heron/ })
      fireEvent.click(screen.getByRole('button', { name: 'Set species' }))
      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: 'start' })
      )
    } finally {
      rectSpy.mockRestore()
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('opens with the initial filters', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron')],
      nextCursor: null,
      nextMaxId: null
    })
    const initialFilters: GalleryMediaFilterState = {
      ...setGalleryFilter(
        setGalleryFilter(
          {
            ...EMPTY_GALLERY_FILTERS,
            sort: 'taken_asc'
          },
          'date',
          {
            kind: 'custom',
            from: '2025-10-04',
            to: '2025-10-12',
            label: 'Album dates · 4–12 Oct 2025'
          }
        ),
        'notInAlbum',
        true
      )
    }

    render(<Harness initialFilters={initialFilters} />)
    await screen.findByRole('button', { name: /Select Heron/ })

    expect(media).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({
        sort: 'taken_asc',
        show: 'not_in_album',
        takenFrom: '2025-10-04',
        takenTo: '2025-10-12'
      })
    )
    expect(screen.getByTestId('filter-not-in-album')).toHaveTextContent('true')
  })

  it('reports every loaded page to onItemsLoaded', async () => {
    const onItemsLoaded = vi.fn()
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextCursor: 'cur-page-2',
        nextMaxId: null
      })
      .mockResolvedValueOnce({
        items: [named('2', 'Robin')],
        nextCursor: null,
        nextMaxId: null
      })

    render(<Harness onItemsLoaded={onItemsLoaded} />)
    await screen.findByRole('button', { name: /Select Heron/ })
    expect(onItemsLoaded).toHaveBeenCalledTimes(1)
    expect(onItemsLoaded).toHaveBeenLastCalledWith([
      expect.objectContaining({ mediaId: '1' })
    ])

    await waitFor(() => expect(mockObserverCallback).not.toBeNull())
    act(() => {
      mockObserverCallback!([
        { isIntersecting: true } as IntersectionObserverEntry
      ])
    })

    await screen.findByRole('button', { name: /Select Robin/ })
    expect(onItemsLoaded).toHaveBeenCalledTimes(2)
    expect(onItemsLoaded).toHaveBeenLastCalledWith([
      expect.objectContaining({ mediaId: '2' })
    ])
  })

  describe('day grouping', () => {
    it('groups two days into two headings (level 3) with server counts from page.days', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-04T10:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null,
        days: {
          '2025-10-12': {
            count: 4,
            inAlbum: 0,
            placeName: 'Box Hill, Surrey',
            activity: null
          },
          '2025-10-04': {
            count: 14,
            inAlbum: 0,
            placeName: null,
            activity: null
          }
        }
      })

      render(<Harness />)

      expect(
        await screen.findByRole('heading', {
          level: 3,
          name: /Sun 12 Oct 2025/
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', {
          level: 3,
          name: /Sat 4 Oct 2025/
        })
      ).toBeInTheDocument()
      expect(
        screen.getByText(/Box Hill, Surrey · 4 photos/)
      ).toBeInTheDocument()
      expect(screen.getByText(/14 photos/)).toBeInTheDocument()
    })

    it('groups dateless photos under a date sort with "Uploaded …" heading', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', {
            takenAt: null,
            uploadedAt: '2025-10-03T10:00:00Z'
          })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness />)

      expect(
        await screen.findByRole('heading', {
          level: 3,
          name: /Uploaded Fri 3 Oct 2025/
        })
      ).toBeInTheDocument()
    })

    it('groups every photo under sort=uploaded with "Uploaded …" heading', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', {
            takenAt: '2025-10-01T10:00:00Z',
            uploadedAt: '2025-10-03T10:00:00Z'
          })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(
        <Harness
          initialFilters={{
            ...EMPTY_GALLERY_FILTERS,
            sort: 'uploaded'
          }}
        />
      )

      expect(
        await screen.findByRole('heading', {
          level: 3,
          name: /Uploaded Fri 3 Oct 2025/
        })
      ).toBeInTheDocument()
    })

    it('appends to existing day group when a day spans two pages', async () => {
      media
        .mockResolvedValueOnce({
          items: [named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' })],
          nextCursor: 'cur-page-2',
          nextMaxId: null
        })
        .mockResolvedValueOnce({
          items: [named('2', 'Robin', { takenAt: '2025-10-12T08:00:00Z' })],
          nextCursor: null,
          nextMaxId: null
        })

      render(<Harness />)

      await screen.findByRole('button', { name: /Select Heron/ })
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)

      await waitFor(() => expect(mockObserverCallback).not.toBeNull())
      act(() => {
        mockObserverCallback!([
          { isIntersecting: true } as IntersectionObserverEntry
        ])
      })

      await screen.findByRole('button', { name: /Select Robin/ })
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
      expect(
        screen.getByRole('heading', { level: 3, name: /Sun 12 Oct 2025/ })
      ).toBeInTheDocument()
    })
  })

  describe('Select day', () => {
    it('shows the correct button label states for none / some / all / all in album / room left / album full', async () => {
      // 1. None picked -> "Select day"
      media.mockResolvedValueOnce({
        items: [named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' })],
        nextCursor: null,
        nextMaxId: null
      })
      const { unmount } = render(<Harness />)
      expect(
        await screen.findByRole('button', {
          name: /Select day, Sun 12 Oct 2025/
        })
      ).toBeInTheDocument()
      unmount()

      // 2. Some picked -> "Select 1 more"
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })
      const { unmount: unmount2 } = render(<Harness initialSelected={['1']} />)
      expect(
        await screen.findByRole('button', {
          name: /Select 1 more, Sun 12 Oct 2025/
        })
      ).toBeInTheDocument()
      unmount2()

      // 3. All picked -> "Deselect day"
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })
      const { unmount: unmount3 } = render(
        <Harness initialSelected={['1', '2']} />
      )
      expect(
        await screen.findByRole('button', {
          name: /Deselect day, Sun 12 Oct 2025/
        })
      ).toBeInTheDocument()
      unmount3()

      // 4. All in album -> aria-disabled "All in album"
      media.mockResolvedValueOnce({
        items: [named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' })],
        nextCursor: null,
        nextMaxId: null
      })
      const { unmount: unmount4 } = render(
        <Harness albumId="alb-1" existingIds={['1']} />
      )
      const allInAlbumBtn = await screen.findByRole('button', {
        name: /All in album, Sun 12 Oct 2025/
      })
      expect(allInAlbumBtn).toHaveAttribute('aria-disabled', 'true')
      expect(allInAlbumBtn).not.toBeDisabled()
      unmount4()

      // 5. Room left -> "Select 1 (room left)"
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })
      const { unmount: unmount5 } = render(<Harness capacity={1} />)
      expect(
        await screen.findByRole('button', {
          name: /Select 1 \(room left\), Sun 12 Oct 2025/
        })
      ).toBeInTheDocument()
      unmount5()

      // 6. Album full -> aria-disabled "Album full"
      media.mockResolvedValueOnce({
        items: [named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' })],
        nextCursor: null,
        nextMaxId: null
      })
      const { unmount: unmount6 } = render(
        <Harness capacity={1} initialSelected={['other']} />
      )
      const albumFullBtn = await screen.findByRole('button', {
        name: /Album full, Sun 12 Oct 2025/
      })
      expect(albumFullBtn).toHaveAttribute('aria-disabled', 'true')
      expect(albumFullBtn).not.toBeDisabled()
      unmount6()
    })

    it('does not call a filtered day all picked from picks made before the filter', async () => {
      // No filter: five photos on one day, all five picked.
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:30:00Z' }),
          named('3', 'Wren', { takenAt: '2025-10-12T09:00:00Z' }),
          named('4', 'Dunnock', { takenAt: '2025-10-12T08:30:00Z' }),
          named('5', 'Sparrow', { takenAt: '2025-10-12T08:00:00Z' })
        ],
        days: { '2025-10-12': { count: 5, placeName: null, activity: null } },
        nextCursor: null,
        nextMaxId: null
      })
      render(<Harness />)
      for (const name of ['Heron', 'Robin', 'Wren', 'Dunnock', 'Sparrow']) {
        fireEvent.click(
          await screen.findByRole('button', {
            name: new RegExp(`Select ${name}`)
          })
        )
      }
      expect(
        screen.getByRole('button', { name: /Deselect day, Sun 12 Oct 2025/ })
      ).toBeInTheDocument()

      // The filter changes to one that shows a single other photo on the
      // same day: the five picks are not on screen, so the day must not
      // count them as picked.
      media.mockResolvedValueOnce({
        items: [named('9', 'Puffin', { takenAt: '2025-10-12T10:00:00Z' })],
        days: { '2025-10-12': { count: 1, placeName: null, activity: null } },
        nextCursor: null,
        nextMaxId: null
      })
      fireEvent.click(screen.getByRole('button', { name: 'Set species' }))
      await screen.findByRole('button', { name: /Select Puffin/ })

      expect(
        screen.getByRole('button', { name: 'Select day, Sun 12 Oct 2025' })
      ).toBeInTheDocument()
      expect(screen.queryAllByText('all picked')).toHaveLength(0)
    })

    it('fetches day ids on Select day, skips existing/selected, shows undo toast and undoes', async () => {
      media.mockResolvedValueOnce({
        items: [named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' })],
        days: {
          '2025-10-12': {
            count: 4,
            inAlbum: 1,
            placeName: null,
            activity: null
          }
        },
        nextCursor: null,
        nextMaxId: null
      })
      mediaIds.mockResolvedValueOnce(['1', '2', '3', 'existing-1'])

      render(
        <Harness
          existingIds={['existing-1']}
          initialSelected={['1']}
          albumId="alb-1"
        />
      )

      const selectBtn = await screen.findByRole('button', {
        name: /Select 2 more, Sun 12 Oct 2025/
      })
      fireEvent.click(selectBtn)

      await waitFor(() => {
        expect(mediaIds).toHaveBeenCalledWith(
          'owner',
          expect.objectContaining({
            dayKey: '2025-10-12',
            albumId: 'alb-1',
            limit: 3
          })
        )
      })

      // '1' was already selected, 'existing-1' is in album. New: '2', '3'.
      expect(await screen.findByTestId('selected')).toHaveTextContent('1,2,3')
      expect(screen.getByTestId('album-toast')).toHaveTextContent(
        'Selected 2 photos from Sun 12 Oct 2025'
      )
      expect(screen.getByTestId('album-toast')).toHaveClass('max-w-full')
      const feedback = screen.getByTestId('day-feedback-container')
      expect(feedback).toHaveClass('sticky', '-bottom-1.5', 'bg-background')
      expect(feedback).toContainElement(screen.getByTestId('album-toast'))
      expect(feedback.parentElement?.lastElementChild).toBe(feedback)

      // Click Undo
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(screen.getByTestId('selected')).toHaveTextContent('1')
    })

    it('loads missing day items through list pages and reports them to the host', async () => {
      const dayItem = (id: string, name: string) =>
        named(id, name, { takenAt: '2025-10-12T10:00:00Z' })
      const onItemsLoaded = vi.fn()
      media.mockResolvedValueOnce({
        items: [dayItem('1', 'Heron')],
        days: { '2025-10-12': { count: 3, placeName: null, activity: null } },
        nextCursor: null,
        nextMaxId: null
      })
      media.mockResolvedValueOnce({
        items: [dayItem('2', 'Robin')],
        nextCursor: 'page-2',
        nextMaxId: null
      })
      media.mockResolvedValueOnce({
        items: [dayItem('3', 'Wren')],
        nextCursor: null,
        nextMaxId: null
      })
      mediaIds.mockResolvedValueOnce(['1', '2', '3'])

      render(<Harness onItemsLoaded={onItemsLoaded} />)
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Select day, Sun 12 Oct 2025'
        })
      )

      await waitFor(() =>
        expect(screen.getByTestId('selected')).toHaveTextContent('1,2,3')
      )
      expect(media).toHaveBeenNthCalledWith(
        2,
        'owner',
        expect.objectContaining({
          dayKey: '2025-10-12',
          limit: 60
        })
      )
      expect(media).toHaveBeenNthCalledWith(
        3,
        'owner',
        expect.objectContaining({
          dayKey: '2025-10-12',
          cursor: 'page-2',
          limit: 60
        })
      )
      const reportedIds = onItemsLoaded.mock.calls.flatMap(([items]) =>
        items.map((item: GalleryItemEntity) => item.mediaId)
      )
      expect(reportedIds).toEqual(expect.arrayContaining(['2', '3']))
    })

    it('filters dateless uploads by their upload day under a date sort', async () => {
      const uploadDay = new Date('2025-10-12T10:00:00.000Z').getTime()
      const dateless = buildGalleryItem('1', {
        takenAt: null,
        uploadedAt: '2025-10-12T10:00:00.000Z',
        attachment: {
          ...buildGalleryItem('1').attachment,
          createdAt: uploadDay
        }
      })
      media
        .mockResolvedValueOnce({
          items: [dateless],
          days: {
            'uploaded:2025-10-12': {
              count: 1,
              placeName: null,
              activity: null
            }
          },
          nextCursor: null,
          nextMaxId: null
        })
        .mockResolvedValueOnce({ items: [], nextCursor: null, nextMaxId: null })
      mediaIds.mockResolvedValueOnce(['missing'])

      render(
        <Harness
          initialFilters={{ ...EMPTY_GALLERY_FILTERS, sort: 'taken_desc' }}
        />
      )
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Select day, Uploaded Sun 12 Oct 2025'
        })
      )

      await waitFor(() => expect(media).toHaveBeenCalledTimes(2))
      expect(media).toHaveBeenNthCalledWith(
        2,
        'owner',
        expect.objectContaining({
          dayKey: 'uploaded:2025-10-12',
          limit: 60
        })
      )
    })

    it('hydrates Select day picks with the filters they were selected under', async () => {
      media.mockResolvedValue({
        items: [named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' })],
        days: { '2025-10-12': { count: 3, placeName: null, activity: null } },
        nextCursor: null,
        nextMaxId: null
      })
      mediaIds.mockResolvedValueOnce(['1', '2', '3'])

      render(<Harness />)
      fireEvent.click(
        await screen.findByRole('button', { name: 'Set species' })
      )
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Select day, Sun 12 Oct 2025'
        })
      )

      // The initial load, the reload under the species filter, then the
      // day's hydration: the hydration pages the query the picks were
      // selected under, not the picker's unfiltered default.
      await waitFor(() => expect(media).toHaveBeenCalledTimes(3))
      expect(media).toHaveBeenLastCalledWith(
        'owner',
        expect.objectContaining({
          dayKey: '2025-10-12',
          subject: 'sci:alcedo atthis',
          sort: 'taken_desc',
          limit: 60
        })
      )
    })

    it('stops requesting hydration pages after unmount', async () => {
      const nextPage = createDeferred<{
        items: GalleryItemEntity[]
        nextCursor: string | null
        nextMaxId: string | null
      }>()
      media
        .mockResolvedValueOnce({
          items: [
            named('1', 'Heron', {
              takenAt: '2025-10-12T10:00:00Z',
              uploadedAt: '2025-10-12T10:00:00.000Z'
            })
          ],
          days: { '2025-10-12': { count: 3, placeName: null, activity: null } },
          nextCursor: null,
          nextMaxId: null
        })
        .mockReturnValueOnce(nextPage.promise)
      mediaIds.mockResolvedValueOnce(['2', '3', '4'])

      const { unmount } = render(<Harness />)
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Select day, Sun 12 Oct 2025'
        })
      )
      await waitFor(() => expect(media).toHaveBeenCalledTimes(2))
      const signal = media.mock.calls[1][1]?.signal

      unmount()
      expect(signal?.aborted).toBe(true)
      await act(async () => {
        nextPage.resolve({
          items: [named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' })],
          nextCursor: 'page-2',
          nextMaxId: null
        })
        await nextPage.promise
      })

      expect(media).toHaveBeenCalledTimes(2)
    })

    it('limits sort=uploaded hydration to 50 day-bounded pages from the top', async () => {
      const uploadDay = new Date('2025-10-12T10:00:00.000Z').getTime()
      const onItemsLoaded = vi.fn()
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', {
            takenAt: '2025-10-12T10:00:00Z',
            uploadedAt: '2025-10-12T10:00:00.000Z',
            attachment: {
              ...buildGalleryItem('1').attachment,
              createdAt: uploadDay
            }
          })
        ],
        days: {
          'uploaded:2025-10-12': { count: 2, placeName: null, activity: null }
        },
        nextCursor: null,
        nextMaxId: null
      })
      for (let page = 1; page <= 50; page += 1) {
        media.mockResolvedValueOnce({
          items:
            page === 49
              ? [
                  named('not-loaded', 'Robin', {
                    takenAt: '2025-10-12T09:00:00Z',
                    uploadedAt: '2025-10-12T09:00:00.000Z',
                    attachment: {
                      ...buildGalleryItem('not-loaded').attachment,
                      createdAt: uploadDay
                    }
                  })
                ]
              : [],
          nextCursor: null,
          nextMaxId: page <= 50 ? `page-${page + 1}` : null
        })
      }
      mediaIds.mockResolvedValueOnce(['not-loaded', 'still-missing'])

      render(
        <Harness
          initialFilters={{ ...EMPTY_GALLERY_FILTERS, sort: 'uploaded' }}
          onItemsLoaded={onItemsLoaded}
        />
      )
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Select day, Uploaded Sun 12 Oct 2025'
        })
      )

      await waitFor(() => expect(onItemsLoaded).toHaveBeenCalled())
      expect(media).toHaveBeenCalledTimes(51)
      for (const [, options] of media.mock.calls.slice(1)) {
        expect(options).toHaveProperty('dayKey', 'uploaded:2025-10-12')
        expect(options).toHaveProperty('limit', 60)
      }
    })

    it('removes day ids on Deselect day, shows toast and undoes', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })
      // The deselect reads the day's ids from the server again, in one
      // request capped at the album item maximum.
      mediaIds.mockResolvedValue(['1', '2'])

      render(<Harness initialSelected={['1', '2', 'other']} />)

      const deselectBtn = await screen.findByRole('button', {
        name: /Deselect day, Sun 12 Oct 2025/
      })
      fireEvent.click(deselectBtn)

      await waitFor(() =>
        expect(screen.getByTestId('selected')).toHaveTextContent(/^other$/)
      )
      expect(mediaIds).toHaveBeenCalledWith(
        'owner',
        expect.objectContaining({ dayKey: '2025-10-12', limit: 2000 })
      )
      expect(screen.getByTestId('album-toast')).toHaveTextContent(
        'Deselected 2 photos from Sun 12 Oct 2025'
      )

      // Undo restores them
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await waitFor(() =>
        expect(screen.getByTestId('selected')).toHaveTextContent('other,1,2')
      )
    })

    it('shows Alert with retry when Select day fails and preserves selection', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })
      mediaIds
        .mockRejectedValueOnce(new Error('Day fetch failed'))
        .mockResolvedValueOnce(['1', '2'])

      render(<Harness initialSelected={['initial']} />)

      const selectBtn = await screen.findByRole('button', {
        name: /Select day, Sun 12 Oct 2025/
      })
      fireEvent.click(selectBtn)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Day fetch failed'
      )
      const feedback = screen.getByTestId('day-feedback-container')
      expect(feedback).toHaveClass('sticky', '-bottom-1.5', 'bg-background')
      expect(feedback).toContainElement(screen.getByRole('alert'))
      expect(feedback.parentElement?.lastElementChild).toBe(feedback)
      expect(screen.getByTestId('selected')).toHaveTextContent('initial')

      // Retry
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() => {
        expect(screen.getByTestId('selected')).toHaveTextContent('initial,1,2')
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('does not apply a pending Select day response after the host starts saving', async () => {
      const response = createDeferred<string[]>()
      const item = named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' })
      media.mockResolvedValueOnce({
        items: [item],
        days: {
          '2025-10-12': { count: 2, placeName: null, activity: null }
        },
        nextCursor: null,
        nextMaxId: null
      })
      mediaIds.mockReturnValueOnce(response.promise)

      const SubmitHarness = () => {
        const [selected, setSelected] = useState(['1'])
        const [disabled, setDisabled] = useState(false)
        const [submitted, setSubmitted] = useState<string[] | null>(null)
        return (
          <>
            <GalleryAlbumPicker
              ownerId="owner"
              selected={selected}
              onChange={setSelected}
              capacity={2000}
              seedItems={[item]}
              disabled={disabled}
            />
            <button
              type="button"
              onClick={() => {
                setSubmitted([...selected])
                setDisabled(true)
              }}
            >
              Submit
            </button>
            <span data-testid="submitted-ids">{JSON.stringify(submitted)}</span>
            <span data-testid="current-ids">{selected.join(',')}</span>
          </>
        )
      }
      render(<SubmitHarness />)

      fireEvent.click(
        await screen.findByRole('button', {
          name: /Select 1 more, Sun 12 Oct 2025/
        })
      )
      await waitFor(() => expect(mediaIds).toHaveBeenCalledOnce())
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      expect(screen.getByTestId('submitted-ids')).toHaveTextContent('["1"]')

      await act(async () => {
        response.resolve(['1', '2'])
        await Promise.resolve()
      })

      expect(screen.getByTestId('current-ids')).toHaveTextContent('1')
      expect(screen.getByTestId('submitted-ids')).toHaveTextContent('["1"]')
    })

    it('counts seedItems in pickedInDay on mount before their page loads', async () => {
      const seeded = named('seed-1', 'Heron', {
        takenAt: '2025-10-12T10:00:00Z'
      })
      media.mockResolvedValueOnce({
        items: [
          seeded,
          named('seed-2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness seedItems={[seeded]} initialSelected={['seed-1']} />)

      // Even before user interaction, seed-1 is recognized in 2025-10-12
      expect(
        await screen.findByRole('button', {
          name: /Select 1 more, Sun 12 Oct 2025/
        })
      ).toBeInTheDocument()
      expect(screen.getByText(/2 photos · 1 picked/)).toBeInTheDocument()
    })
  })

  describe('range selection', () => {
    it('unpicks a run when Shift-clicking from an unpicked anchor', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' }),
          named('3', 'Swan', { takenAt: '2025-10-12T08:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness initialSelected={['1', '2', '3']} />)

      const tile1 = await screen.findByRole('button', { name: /Heron/ })
      const tile3 = screen.getByRole('button', { name: /Swan/ })

      // Click tile 1 to unselect it and set anchor to '1'
      fireEvent.click(tile1)
      expect(screen.getByTestId('selected')).toHaveTextContent('2,3')

      // Shift-click tile 3: anchor is unselected, so it unselects the range
      fireEvent.click(tile3, { shiftKey: true })
      expect(screen.getByTestId('selected')).toHaveTextContent('')
      expect(screen.getByRole('status')).toHaveTextContent(
        'Deselected 2 photos'
      )
    })

    it('picks across two groups and skips in-album tiles on Shift-click', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' }),
          named('3', 'Swan', { takenAt: '2025-10-04T10:00:00Z' }),
          named('4', 'Duck', { takenAt: '2025-10-04T09:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness existingIds={['2']} />)

      const tile1 = await screen.findByRole('button', { name: /Heron/ })
      const tile4 = screen.getByRole('button', { name: /Duck/ })

      // Click tile 1 -> anchor = '1', selected = ['1']
      fireEvent.click(tile1)
      expect(screen.getByTestId('selected')).toHaveTextContent('1')

      // Shift-click tile 4 across day groups -> selects 1, 3, 4 (skips 2)
      fireEvent.click(tile4, { shiftKey: true })
      expect(screen.getByTestId('selected')).toHaveTextContent('1,3,4')
      expect(screen.getByRole('status')).toHaveTextContent('Selected 2 photos')
    })

    it('stops range selection at room left and announces album is full', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' }),
          named('3', 'Swan', { takenAt: '2025-10-12T08:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness capacity={2} />)

      const tile1 = await screen.findByRole('button', { name: /Heron/ })
      const tile3 = screen.getByRole('button', { name: /Swan/ })

      fireEvent.click(tile1)
      expect(screen.getByTestId('selected')).toHaveTextContent('1')

      fireEvent.click(tile3, { shiftKey: true })
      expect(screen.getByTestId('selected')).toHaveTextContent('1,2')
      expect(screen.getByRole('status')).toHaveTextContent(
        'Selected 1 photo, the album is full'
      )
    })

    it('applies a Shift+Space range ending on an in-album tile up to it', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' }),
          named('3', 'Swan', { takenAt: '2025-10-12T08:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness existingIds={['3']} />)

      const tile1 = await screen.findByRole('button', { name: /Heron/ })
      const member = screen.getByRole('button', {
        name: /Swan.*already in the album/
      })

      fireEvent.click(tile1)
      expect(screen.getByTestId('selected')).toHaveTextContent('1')

      // Shift+Space on the in-album tile adds the intervening photo and
      // skips the member itself, like ranges skip blocked tiles in the
      // middle.
      fireEvent.keyDown(member, { key: ' ', shiftKey: true })
      expect(screen.getByTestId('selected')).toHaveTextContent('1,2')
      expect(screen.getByRole('status')).toHaveTextContent('Selected 1 photo')

      // The anchor does not move to the member tile.
      expect(member).not.toHaveClass('ring-foreground')
    })

    it('keeps the anchor when a deselect range ends on an in-album tile', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' }),
          named('3', 'Swan', { takenAt: '2025-10-12T08:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness existingIds={['3']} initialSelected={['1', '2']} />)

      const tile1 = await screen.findByRole('button', { name: /Heron/ })
      const member = screen.getByRole('button', {
        name: /Swan.*already in the album/
      })

      // Unpick tile 1: it stays the anchor, so it wears the anchor ring.
      fireEvent.click(tile1)
      expect(screen.getByTestId('selected')).toHaveTextContent('2')
      expect(tile1).toHaveClass('ring-foreground')

      // Shift+click on the in-album tile unpicks the range up to it; the
      // member stays unpicked and the anchor stays on tile 1.
      fireEvent.click(member, { shiftKey: true })
      expect(screen.getByTestId('selected')).toHaveTextContent('')
      expect(screen.getByRole('status')).toHaveTextContent('Deselected 1 photo')
      expect(tile1).toHaveClass('ring-foreground')
      expect(member).not.toHaveClass('ring-foreground')
    })

    it('applies a Shift-click range ending on a blocked tile without picking it', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' }),
          named('3', 'Swan', { takenAt: '2025-10-12T08:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness capacity={1} />)

      const tile1 = await screen.findByRole('button', { name: /Heron/ })
      const blocked = screen.getByRole('button', { name: /Select Swan/ })

      fireEvent.click(tile1)
      expect(screen.getByTestId('selected')).toHaveTextContent('1')
      // The album is full, so Swan is blocked.
      expect(blocked).toHaveAttribute('aria-disabled', 'true')

      // Shift+click on the blocked tile reaches the range handler; the
      // range has no room left, so nothing changes and the blocked tile
      // stays unpicked with the anchor unmoved.
      fireEvent.click(blocked, { shiftKey: true })
      expect(screen.getByTestId('selected')).toHaveTextContent('1')
      expect(blocked).not.toHaveClass('ring-foreground')

      // A plain click on the blocked tile still does nothing.
      fireEvent.click(blocked)
      expect(screen.getByTestId('selected')).toHaveTextContent('1')
    })

    it('treats Shift-click with null anchor as a single toggle and sets anchor', async () => {
      media.mockResolvedValueOnce({
        items: [named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' })],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness />)

      const tile1 = await screen.findByRole('button', { name: /Heron/ })
      fireEvent.click(tile1, { shiftKey: true })

      expect(screen.getByTestId('selected')).toHaveTextContent('1')
    })
  })

  describe('keyboard selection across headers (Missing coverage 2)', () => {
    it('selects across a day header with Space on tile 1 and Shift+Space on tile 4', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' }),
          named('3', 'Swan', { takenAt: '2025-10-04T10:00:00Z' }),
          named('4', 'Duck', { takenAt: '2025-10-04T09:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness />)

      const tile1 = await screen.findByRole('button', { name: /Heron/ })
      const tile4 = screen.getByRole('button', { name: /Duck/ })

      // Press Space on tile 1
      fireEvent.keyDown(tile1, { key: ' ' })
      expect(screen.getByTestId('selected')).toHaveTextContent('1')

      // Press Shift+Space on tile 4 across the header
      fireEvent.keyDown(tile4, { key: ' ', shiftKey: true })
      expect(screen.getByTestId('selected')).toHaveTextContent('1,2,3,4')
      expect(screen.getByRole('status')).toHaveTextContent('Selected 3 photos')
    })
  })

  describe('roving grid focus (Missing coverage 3)', () => {
    it('keeps tabIndex=0 on first tile when in-album and ArrowRight moves focus past it', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' }),
          named('2', 'Robin', { takenAt: '2025-10-12T09:00:00Z' }),
          named('3', 'Swan', { takenAt: '2025-10-12T08:00:00Z' })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness existingIds={['1']} />)

      const tile1 = await screen.findByRole('button', {
        name: /Heron.*already in the album/
      })
      const tile2 = screen.getByRole('button', { name: /Select Robin/ })

      // Tile 1 is in-album (isMember): must have aria-disabled, not disabled, and tabIndex=0
      expect(tile1).toHaveAttribute('aria-disabled', 'true')
      expect(tile1).not.toBeDisabled()
      expect(tile1).toHaveAttribute('tabindex', '0')

      // Focus tile 1
      tile1.focus()
      expect(document.activeElement).toBe(tile1)

      // ArrowRight on tile 1
      fireEvent.keyDown(tile1, { key: 'ArrowRight' })

      // Focus moved to tile 2 past the in-album tile
      expect(document.activeElement).toBe(tile2)
      expect(tile2).toHaveAttribute('tabindex', '0')
      expect(tile1).toHaveAttribute('tabindex', '-1')
    })

    it('does not intercept Tab key', async () => {
      media.mockResolvedValueOnce({
        items: [named('1', 'Heron', { takenAt: '2025-10-12T10:00:00Z' })],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness />)

      const tile1 = await screen.findByRole('button', { name: /Heron/ })
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true
      })
      tile1.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })
  })

  describe('tile captions and accessible names', () => {
    it('omits date from visible tile caption but includes it in aria-label', async () => {
      media.mockResolvedValueOnce({
        items: [
          named('1', 'Heron', {
            subject: { name: 'Grey heron' } as never,
            takenAt: '2025-10-12T10:00:00Z'
          })
        ],
        nextCursor: null,
        nextMaxId: null
      })

      render(<Harness />)

      // Visible caption shows species only, no date
      expect(await screen.findByText('Grey heron')).toBeInTheDocument()
      expect(
        screen.queryByText('Grey heron · 12 Oct 2025')
      ).not.toBeInTheDocument()

      // Accessible name includes the capture date
      expect(
        screen.getByRole('button', {
          name: 'Select Heron, photo 1, Grey heron, taken 12 Oct 2025'
        })
      ).toBeInTheDocument()
    })
  })
})
