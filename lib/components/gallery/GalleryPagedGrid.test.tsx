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
    onItemsDeleted
  }: {
    items: GalleryItemEntity[]
    selection?: unknown
    albumsOwnerId?: string | null
    onItemEdited?: (item: GalleryItemEntity) => void
    onViewerClosed?: () => void
    onPostItems?: (mediaIds: string[]) => void
    onItemsDeleted?: (mediaIds: string[]) => void
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
      limit: 30,
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
      limit: 30,
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
  })
})
