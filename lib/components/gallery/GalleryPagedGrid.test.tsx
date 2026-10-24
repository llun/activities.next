/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'

import { getGalleryMedia } from '@/lib/client'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'

import {
  GalleryPagedGrid,
  type GalleryPagedGridController
} from './GalleryPagedGrid'

vi.mock('@/lib/client', () => ({
  getGalleryMedia: vi.fn()
}))

vi.mock('@/lib/components/gallery/GalleryGrid', () => ({
  GalleryGrid: ({
    items,
    selection,
    albumsOwnerId,
    onItemEdited,
    onViewerClosed,
    onPostItems,
    onItemsDeleted,
    onAlbumsChanged
  }: {
    items: GalleryItemEntity[]
    selection?: unknown
    albumsOwnerId?: string | null
    onItemEdited?: (item: GalleryItemEntity) => void
    onViewerClosed?: () => void
    onPostItems?: (mediaIds: string[]) => void
    onItemsDeleted?: (mediaIds: string[]) => void
    onAlbumsChanged?: (albumIds: string[]) => void
  }) => (
    <ul
      data-testid="grid"
      data-selecting={selection ? 'yes' : 'no'}
      data-owner={albumsOwnerId ?? ''}
    >
      {items.map((item) => (
        <li key={item.mediaId}>{item.mediaId}</li>
      ))}
      <button
        onClick={() =>
          onItemEdited?.({
            ...items[0],
            inGallery: false,
            attachment: { ...items[0].attachment, name: 'Edited' }
          })
        }
      >
        Edit first
      </button>
      <button onClick={() => onViewerClosed?.()}>Close viewer</button>
      <button onClick={() => onPostItems?.([items[0].mediaId])}>
        Post first
      </button>
      <button onClick={() => onItemsDeleted?.([items[0].mediaId])}>
        Delete first
      </button>
      <button onClick={() => onAlbumsChanged?.(['album-1'])}>
        Change albums
      </button>
      <li data-testid="first-name">{items[0]?.attachment.name}</li>
    </ul>
  )
}))

const getGalleryMediaMock = getGalleryMedia as jest.Mock

describe('GalleryPagedGrid', () => {
  beforeEach(() => {
    getGalleryMediaMock.mockReset()
  })

  it('shows the server page without fetching, and pages with nextMaxId', async () => {
    getGalleryMediaMock.mockResolvedValue({
      items: [buildGalleryItem('1'), buildGalleryItem('3')],
      nextMaxId: null
    })
    render(
      <GalleryPagedGrid
        actorId="actor-1"
        subject="sci:x"
        initialPage={{
          items: [buildGalleryItem('3'), buildGalleryItem('2')],
          nextMaxId: '2'
        }}
      />
    )
    expect(getGalleryMediaMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('grid')).toHaveTextContent('32')

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('321')
    )
    expect(getGalleryMediaMock).toHaveBeenCalledWith('actor-1', {
      limit: 24,
      maxId: '2',
      subject: 'sci:x',
      category: undefined
    })
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('loads its own first page when the server did not, with a skeleton meanwhile', async () => {
    let resolve: (page: unknown) => void = () => {}
    getGalleryMediaMock.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    render(<GalleryPagedGrid actorId="actor-1" category="bird" />)
    expect(screen.getByText('Loading photos')).toBeInTheDocument()

    resolve({ items: [buildGalleryItem('9')], nextMaxId: null })
    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('9')
    )
    expect(getGalleryMediaMock).toHaveBeenCalledWith('actor-1', {
      limit: 24,
      maxId: undefined,
      subject: undefined,
      category: 'bird'
    })
  })

  it('says so when there is nothing to show', async () => {
    getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
    render(<GalleryPagedGrid actorId="actor-1" emptyTitle="No birds yet" />)
    expect(await screen.findByText('No birds yet')).toBeInTheDocument()
  })

  it('reports a failed load and lets the user retry', async () => {
    getGalleryMediaMock.mockRejectedValueOnce(new Error('Boom'))
    render(<GalleryPagedGrid actorId="actor-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')

    getGalleryMediaMock.mockResolvedValueOnce({
      items: [buildGalleryItem('7')],
      nextMaxId: null
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('7')
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps following nextMaxId past an empty page, then finds photos', async () => {
    getGalleryMediaMock
      .mockResolvedValueOnce({ items: [], nextMaxId: '90' })
      .mockResolvedValueOnce({
        items: [buildGalleryItem('5')],
        nextMaxId: null
      })
    render(<GalleryPagedGrid actorId="actor-1" subject="name:rare" />)

    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('5')
    )
    expect(getGalleryMediaMock).toHaveBeenCalledTimes(2)
    expect(getGalleryMediaMock).toHaveBeenLastCalledWith(
      'actor-1',
      expect.objectContaining({ maxId: '90' })
    )
  })

  it('stops auto-continuing after a few empty pages and offers Load more', async () => {
    getGalleryMediaMock.mockImplementation(async (_: string, { maxId }) => ({
      items: [],
      nextMaxId: String(Number(maxId ?? 100) - 1)
    }))
    render(<GalleryPagedGrid actorId="actor-1" subject="name:rare" />)

    expect(
      await screen.findByRole('button', { name: 'Load more' })
    ).toBeInTheDocument()
    expect(getGalleryMediaMock).toHaveBeenCalledTimes(3)
    expect(screen.queryByText(/No photos/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(getGalleryMediaMock).toHaveBeenCalledTimes(6))
  })

  it('passes select mode and the owner id on to the grid', () => {
    render(
      <GalleryPagedGrid
        actorId="actor-1"
        initialPage={{ items: [buildGalleryItem('1')], nextMaxId: null }}
        selection={{ selected: new Set(), onToggle: vi.fn() }}
        albumsOwnerId="owner-1"
      />
    )

    expect(screen.getByTestId('grid')).toHaveAttribute('data-selecting', 'yes')
    expect(screen.getByTestId('grid')).toHaveAttribute('data-owner', 'owner-1')
  })

  it('tells the parent which photos are loaded, as pages arrive', async () => {
    const onItemsChange = vi.fn()
    getGalleryMediaMock.mockResolvedValue({
      items: [buildGalleryItem('1')],
      nextMaxId: null
    })
    render(
      <GalleryPagedGrid
        actorId="actor-1"
        initialPage={{ items: [buildGalleryItem('3')], nextMaxId: '3' }}
        onItemsChange={onItemsChange}
      />
    )
    expect(onItemsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ mediaId: '3' })
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(onItemsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ mediaId: '3' }),
        expect.objectContaining({ mediaId: '1' })
      ])
    )
  })

  it('does not report again just because the parent passes a new callback', () => {
    const first = vi.fn()
    const second = vi.fn()
    const page = { items: [buildGalleryItem('3')], nextMaxId: null }
    const { rerender } = render(
      <GalleryPagedGrid
        actorId="actor-1"
        initialPage={page}
        onItemsChange={first}
      />
    )
    rerender(
      <GalleryPagedGrid
        actorId="actor-1"
        initialPage={page}
        onItemsChange={second}
      />
    )

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })
  it('asks for the show filter it was given', async () => {
    getGalleryMediaMock.mockResolvedValue({
      items: [buildGalleryItem('1')],
      nextMaxId: null
    })
    render(<GalleryPagedGrid actorId="actor-1" show="hidden" />)

    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('1')
    )
    expect(getGalleryMediaMock).toHaveBeenCalledWith(
      'actor-1',
      expect.objectContaining({ show: 'hidden' })
    )
  })

  it('pages with cursor when initialPage provides nextCursor', async () => {
    getGalleryMediaMock.mockResolvedValue({
      items: [buildGalleryItem('2')],
      nextCursor: null,
      nextMaxId: null
    })
    render(
      <GalleryPagedGrid
        actorId="actor-1"
        initialPage={{
          items: [buildGalleryItem('1')],
          nextCursor: 'cur-100',
          nextMaxId: 'id-999'
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('12')
    )
    expect(getGalleryMediaMock).toHaveBeenCalledWith(
      'actor-1',
      expect.objectContaining({ cursor: 'cur-100' })
    )
    const options = getGalleryMediaMock.mock.calls[0][1]
    expect(options.cursor).toBe('cur-100')
    expect(options.maxId).toBeUndefined()
  })

  it('pages with cursor when nextCursor is returned from a loaded page', async () => {
    getGalleryMediaMock
      .mockResolvedValueOnce({
        items: [buildGalleryItem('1')],
        nextCursor: 'cur-page-1',
        nextMaxId: null
      })
      .mockResolvedValueOnce({
        items: [buildGalleryItem('2')],
        nextCursor: null,
        nextMaxId: null
      })
    render(<GalleryPagedGrid actorId="actor-1" />)
    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('1')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('12')
    )
    expect(getGalleryMediaMock).toHaveBeenLastCalledWith(
      'actor-1',
      expect.objectContaining({ cursor: 'cur-page-1' })
    )
    const options = getGalleryMediaMock.mock.calls[1][1]
    expect(options.cursor).toBe('cur-page-1')
    expect(options.maxId).toBeUndefined()
  })

  it('calls onTotalChange with initialPage.total when initialPage is provided', () => {
    const onTotalChange = vi.fn()
    render(
      <GalleryPagedGrid
        actorId="actor-1"
        initialPage={{
          items: [buildGalleryItem('1')],
          nextMaxId: null,
          total: 42
        }}
        onTotalChange={onTotalChange}
      />
    )
    expect(onTotalChange).toHaveBeenCalledTimes(1)
    expect(onTotalChange).toHaveBeenCalledWith(42)
  })

  it('calls onTotalChange with null when initialPage is provided without total', () => {
    const onTotalChange = vi.fn()
    render(
      <GalleryPagedGrid
        actorId="actor-1"
        initialPage={{
          items: [buildGalleryItem('1')],
          nextMaxId: null
        }}
        onTotalChange={onTotalChange}
      />
    )
    expect(onTotalChange).toHaveBeenCalledTimes(1)
    expect(onTotalChange).toHaveBeenCalledWith(null)
  })

  it('calls onTotalChange with page.total on first fetch, and not when paging', async () => {
    const onTotalChange = vi.fn()
    getGalleryMediaMock.mockResolvedValueOnce({
      items: [buildGalleryItem('1')],
      nextMaxId: 'id-2',
      total: 100
    })
    render(<GalleryPagedGrid actorId="actor-1" onTotalChange={onTotalChange} />)
    await waitFor(() => expect(onTotalChange).toHaveBeenCalledWith(100))
    expect(onTotalChange).toHaveBeenCalledTimes(1)

    getGalleryMediaMock.mockResolvedValueOnce({
      items: [buildGalleryItem('2')],
      nextMaxId: null,
      total: 100
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('12')
    )
    expect(onTotalChange).toHaveBeenCalledTimes(1)
  })

  it('asks for the total on the first page only, and clears it when that page fails', async () => {
    const onTotalChange = vi.fn()
    getGalleryMediaMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [buildGalleryItem('1')], total: 5 })
    render(<GalleryPagedGrid actorId="actor-1" onTotalChange={onTotalChange} />)
    await waitFor(() => expect(onTotalChange).toHaveBeenCalledWith(null))
    expect(getGalleryMediaMock.mock.calls[0][1]).toMatchObject({
      includeTotal: true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onTotalChange).toHaveBeenLastCalledWith(5))
  })

  it('renders custom emptyState when provided and there are no photos', async () => {
    getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
    render(
      <GalleryPagedGrid
        actorId="actor-1"
        emptyState={<div data-testid="custom-empty">Nothing here</div>}
      />
    )
    expect(await screen.findByTestId('custom-empty')).toHaveTextContent(
      'Nothing here'
    )
    expect(
      screen.queryByText('No photos in your gallery yet')
    ).not.toBeInTheDocument()
  })

  it('passes sort, albumId, and query options to getGalleryMedia', async () => {
    getGalleryMediaMock.mockResolvedValue({
      items: [buildGalleryItem('1')],
      nextMaxId: null
    })
    render(
      <GalleryPagedGrid
        actorId="actor-1"
        sort="taken_desc"
        albumId="alb-1"
        query={{
          place: 'Paris',
          takenFrom: '2026-01-01',
          takenTo: '2026-06-30'
        }}
      />
    )
    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('1')
    )
    expect(getGalleryMediaMock).toHaveBeenCalledWith('actor-1', {
      limit: 24,
      subject: undefined,
      category: undefined,
      gearId: undefined,
      show: undefined,
      sort: 'taken_desc',
      albumId: 'alb-1',
      place: 'Paris',
      takenFrom: '2026-01-01',
      takenTo: '2026-06-30'
    })
  })

  describe('editing from the grid', () => {
    const page = (show?: 'in_gallery' | 'hidden' | 'all') => (
      <GalleryPagedGrid
        actorId="actor-1"
        show={show}
        initialPage={{
          items: [
            buildGalleryItem('2', { inGallery: true }),
            buildGalleryItem('1', { inGallery: true })
          ],
          nextMaxId: null
        }}
      />
    )

    it('swaps in the edited tile but keeps it until the viewer closes', () => {
      render(page('in_gallery'))

      fireEvent.click(screen.getByRole('button', { name: 'Edit first' }))

      expect(screen.getByTestId('first-name')).toHaveTextContent('Edited')
      expect(screen.getByTestId('grid')).toHaveTextContent('21')

      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

      expect(screen.getByTestId('grid')).toHaveTextContent('1')
      expect(screen.getByTestId('grid')).not.toHaveTextContent('2')
    })

    it('treats no show filter as the gallery list, like the server', () => {
      render(page())

      fireEvent.click(screen.getByRole('button', { name: 'Edit first' }))
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

      expect(screen.getByTestId('grid')).not.toHaveTextContent('2')
      expect(screen.getByTestId('grid')).toHaveTextContent('1')
    })

    it('keeps an edited tile that still belongs under Everything', () => {
      render(page('all'))

      fireEvent.click(screen.getByRole('button', { name: 'Edit first' }))
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

      expect(screen.getByTestId('grid')).toHaveTextContent('21')
    })

    it('drops a tile that is shown again under Hidden from gallery', () => {
      render(page('hidden'))

      // Both tiles are in the gallery, so neither belongs here.
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

      expect(screen.queryByTestId('grid')).not.toBeInTheDocument()
      expect(screen.getByText('No photos in your gallery yet')).toBeVisible()
    })

    it('lets the page replace tiles it edited itself', () => {
      const controller = createRef<GalleryPagedGridController>()
      render(
        <GalleryPagedGrid
          actorId="actor-1"
          show="in_gallery"
          controllerRef={controller}
          initialPage={{
            items: [
              buildGalleryItem('2', { inGallery: true }),
              buildGalleryItem('1', { inGallery: true })
            ],
            nextMaxId: null
          }}
        />
      )

      act(() =>
        controller.current?.updateItems([
          buildGalleryItem('1', { inGallery: false }),
          buildGalleryItem('9', { inGallery: false })
        ])
      )

      // Tile 1 was hidden so it leaves; 9 was never loaded so it is not added.
      expect(screen.getByTestId('grid')).toHaveTextContent('2')
      expect(screen.getByTestId('grid')).not.toHaveTextContent('1')
      expect(screen.getByTestId('grid')).not.toHaveTextContent('9')
    })
    it('drops a tile that joins an album from a Not in an album grid', () => {
      const controller = createRef<GalleryPagedGridController>()
      render(
        <GalleryPagedGrid
          actorId="actor-1"
          show="not_in_album"
          controllerRef={controller}
          initialPage={{
            items: [
              buildGalleryItem('2', { albumCount: 0 }),
              buildGalleryItem('1', { albumCount: 0 })
            ],
            nextMaxId: null
          }}
        />
      )

      act(() =>
        controller.current?.updateItems([
          buildGalleryItem('1', { albumCount: 1 })
        ])
      )

      // Tile 1 now sits in an album, so it leaves; tile 2 stays.
      expect(screen.getByTestId('grid')).toHaveTextContent('2')
      expect(screen.getByTestId('grid')).not.toHaveTextContent('1')
    })

    it('keeps an unposted tile only under the lists it is in', () => {
      const unposted = (mediaId: string) =>
        buildGalleryItem(mediaId, {
          statusId: null,
          posted: false,
          inGallery: true
        })
      const render_ = (show: 'not_posted' | 'in_gallery') =>
        render(
          <GalleryPagedGrid
            actorId="actor-1"
            show={show}
            initialPage={{
              items: [unposted('2'), buildGalleryItem('1', { posted: true })],
              nextMaxId: null
            }}
          />
        )

      // Not posted: only the unposted tile stays once the viewer closes.
      const { unmount } = render_('not_posted')
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
      expect(screen.getByTestId('grid')).toHaveTextContent('2')
      expect(screen.getByTestId('grid')).not.toHaveTextContent('1')
      unmount()

      // In gallery: both are shown in the gallery.
      render_('in_gallery')
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
      expect(screen.getByTestId('grid')).toHaveTextContent('21')
    })

    it('lets the page drop tiles that were deleted', () => {
      const controller = createRef<GalleryPagedGridController>()
      render(
        <GalleryPagedGrid
          actorId="actor-1"
          show="all"
          controllerRef={controller}
          initialPage={{
            items: [
              buildGalleryItem('3'),
              buildGalleryItem('2'),
              buildGalleryItem('1')
            ],
            nextMaxId: null
          }}
        />
      )

      act(() => controller.current?.removeItems(['3', '1', 'unknown']))

      expect(screen.getByTestId('grid')).toHaveTextContent('2')
      expect(screen.getByTestId('grid')).not.toHaveTextContent('3')
    })

    it('passes Post… from the viewer on, and drops a tile deleted there', () => {
      const onPostItems = vi.fn()
      const onItemsDeleted = vi.fn()
      render(
        <GalleryPagedGrid
          actorId="actor-1"
          show="all"
          onPostItems={onPostItems}
          onItemsDeleted={onItemsDeleted}
          initialPage={{
            items: [buildGalleryItem('2'), buildGalleryItem('1')],
            nextMaxId: null
          }}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Post first' }))
      expect(onPostItems).toHaveBeenCalledWith(['2'])

      fireEvent.click(screen.getByRole('button', { name: 'Delete first' }))
      expect(onItemsDeleted).toHaveBeenCalledWith(['2'])
      expect(screen.getByTestId('grid')).not.toHaveTextContent('2')
    })

    it('passes onAlbumsChanged to GalleryGrid', () => {
      const onAlbumsChanged = vi.fn()
      render(
        <GalleryPagedGrid
          actorId="actor-1"
          onAlbumsChanged={onAlbumsChanged}
          initialPage={{
            items: [buildGalleryItem('1')],
            nextMaxId: null
          }}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Change albums' }))
      expect(onAlbumsChanged).toHaveBeenCalledWith(['album-1'])
    })
  })

  describe('auto-loading and presentation', () => {
    let mockObserverCallback:
      ((entries: IntersectionObserverEntry[]) => void) | null = null

    beforeEach(() => {
      mockObserverCallback = null
      Object.defineProperty(globalThis, 'IntersectionObserver', {
        writable: true,
        configurable: true,
        value: class {
          constructor(
            callback: (entries: IntersectionObserverEntry[]) => void
          ) {
            mockObserverCallback = callback
          }
          observe = vi.fn()
          unobserve = vi.fn()
          disconnect = vi.fn()
        }
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'IntersectionObserver')
    })

    it('loads more automatically on observer intersection and uses a centered container', async () => {
      getGalleryMediaMock
        .mockResolvedValueOnce({
          items: [buildGalleryItem('5')],
          nextMaxId: '90'
        })
        .mockResolvedValueOnce({
          items: [buildGalleryItem('6')],
          nextMaxId: null
        })

      const { container } = render(
        <GalleryPagedGrid actorId="actor-1" subject="sci:x" />
      )

      await waitFor(() =>
        expect(screen.getByTestId('grid')).toHaveTextContent('5')
      )

      // Verify the centered container class is applied to the wrapper
      // text-center is in LOAD_MORE_CONTAINER_CLASS
      const loadMoreContainer = container.querySelector('.text-center.py-4')
      expect(loadMoreContainer).toBeInTheDocument()

      expect(mockObserverCallback).not.toBeNull()

      // Trigger the intersection observer
      act(() => {
        mockObserverCallback!([
          { isIntersecting: true } as IntersectionObserverEntry
        ])
      })

      // Ensure the second page loads
      await waitFor(() =>
        expect(screen.getByTestId('grid')).toHaveTextContent('56')
      )

      expect(getGalleryMediaMock).toHaveBeenCalledTimes(2)
      expect(getGalleryMediaMock).toHaveBeenLastCalledWith(
        'actor-1',
        expect.objectContaining({ maxId: '90' })
      )
    })
  })
})
