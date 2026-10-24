/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { GalleryAlbumPicker } from '@/app/(timeline)/gallery/albums/GalleryAlbumPicker'
import {
  countGalleryMedia,
  getGalleryMedia,
  getGalleryMediaFacets
} from '@/lib/client'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryMediaFilterBarProps } from '@/lib/components/gallery/filters/GalleryMediaFilterBar'
import type { GalleryMediaFilterEmptyProps } from '@/lib/components/gallery/filters/GalleryMediaFilterEmpty'
import {
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
  getGalleryMediaFacets: vi.fn()
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
  albumId
}: {
  capacity?: number
  existingIds?: string[]
  initialSelected?: string[]
  seedItems?: GalleryItemEntity[]
  onFirstItemChange?: (item: GalleryItemEntity | null) => void
  columns?: 4 | 5
  albumId?: string
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
      />
      <output data-testid="selected">{selected.join(',')}</output>
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
    facetsMock.mockResolvedValue({
      species: [],
      places: [],
      dates: [],
      activities: []
    } as unknown as GalleryMediaFacetsResponse)
  })

  afterEach(() => {
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
    expect(await screen.findByText(/Uploaded 14 Mar 2025/)).toBeInTheDocument()
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
    expect(member).toBeDisabled()
    expect(member).toHaveTextContent('In album')

    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('1,3')
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

  it('renders sm:grid-cols-5 when columns is 5 and sm:grid-cols-4 by default', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron')],
      nextCursor: null,
      nextMaxId: null
    })
    const { rerender } = render(<Harness />)
    await screen.findByRole('button', { name: /Select Heron/ })
    expect(screen.getByRole('list')).toHaveClass('sm:grid-cols-4')

    rerender(<Harness columns={5} />)
    expect(screen.getByRole('list')).toHaveClass('sm:grid-cols-5')
  })
})
