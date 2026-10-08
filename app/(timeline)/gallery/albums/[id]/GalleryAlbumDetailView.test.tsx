/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { GalleryAlbumDetailView } from '@/app/(timeline)/gallery/albums/[id]/GalleryAlbumDetailView'
import {
  deleteGalleryAlbum,
  getGalleryAlbumItems,
  removeGalleryAlbumItems,
  updateGalleryAlbum
} from '@/lib/client'
import {
  buildAlbumCard,
  buildAlbumDetail
} from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'

vi.mock('@/lib/client', () => ({
  deleteGalleryAlbum: vi.fn(),
  getGalleryAlbumItems: vi.fn(),
  removeGalleryAlbumItems: vi.fn(),
  updateGalleryAlbum: vi.fn()
}))

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh })
}))

vi.mock('@/lib/components/gallery/GalleryGrid', () => ({
  GalleryGrid: ({ items }: { items: { mediaId: string }[] }) => (
    <ul data-testid="grid">
      {items.map((item) => (
        <li key={item.mediaId}>{item.mediaId}</li>
      ))}
    </ul>
  )
}))

vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog', () => ({
  GalleryAlbumFormDialog: ({
    intent,
    onSaved
  }: {
    intent: string
    onSaved: (id: string) => void
  }) => (
    <div role="dialog" aria-label={`dialog ${intent}`}>
      <button onClick={() => onSaved('a1')}>finish</button>
    </div>
  )
}))

const items = vi.mocked(getGalleryAlbumItems)
const remove = vi.mocked(removeGalleryAlbumItems)
const update = vi.mocked(updateGalleryAlbum)
const del = vi.mocked(deleteGalleryAlbum)

const renderView = (
  detail = buildAlbumDetail(),
  shareUrl = 'https://activities.local/@llun/albums/a1'
) =>
  render(
    <GalleryAlbumDetailView
      ownerId="owner"
      shareUrl={shareUrl}
      detail={detail}
      pageSize={30}
    />
  )

describe('GalleryAlbumDetailView', () => {
  beforeEach(() => {
    for (const mock of [items, remove, update, del, mockPush, mockRefresh]) {
      mock.mockReset()
    }
  })

  it('shows the title, date range and country over the cover, then the facts', () => {
    renderView(
      buildAlbumDetail({
        album: buildAlbumCard('a1', {
          title: 'Kruger',
          description: 'Eight days.',
          coverMediaId: null
        })
      })
    )
    expect(screen.getByRole('heading', { name: 'Kruger' })).toBeInTheDocument()
    expect(
      screen.getByText('12 – 19 Sep 2026 · South Africa')
    ).toBeInTheDocument()
    expect(screen.getByText('Eight days.')).toBeInTheDocument()
    expect(
      screen.getByText('3 photos · 2 species · 1 place · 1 country · 2 days')
    ).toBeInTheDocument()
    expect(screen.getByText('Public')).toBeInTheDocument()
    expect(
      screen.queryByText(/hidden \(threatened species\)/)
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to albums' })
    ).toHaveAttribute('href', '/gallery/albums')
    expect(screen.getByTestId('grid')).toHaveTextContent('a1-1')
  })

  it('tells the owner how many places are hidden from visitors', () => {
    renderView(buildAlbumDetail({ hiddenPlaceCount: 2 }))
    expect(
      screen.getByText('2 places hidden (threatened species)')
    ).toBeInTheDocument()
    expect(screen.getByText(/Only you see these places/)).toBeInTheDocument()
  })

  it('shows a private album as private and cannot share it', () => {
    renderView(
      buildAlbumDetail({
        album: buildAlbumCard('a1', { visibility: 'private' })
      })
    )
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share link' })).toBeDisabled()
  })

  it('copies the share link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'https://activities.local/@llun/albums/a1'
      )
    )
    expect(await screen.findByText('Link copied')).toBeInTheDocument()
  })

  it('refetches the first page for a species chip and for a sort', async () => {
    items.mockResolvedValue({
      items: [buildGalleryItem('lion-1')],
      nextMaxId: null
    })
    renderView()

    fireEvent.click(screen.getByRole('button', { name: /African Lion\s*2/ }))
    await waitFor(() =>
      expect(items).toHaveBeenLastCalledWith('a1', {
        limit: 30,
        sort: 'taken_desc',
        subject: 'sci:panthera leo',
        maxId: undefined
      })
    )
    expect(await screen.findByText('lion-1')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /African Lion\s*2/ })
    ).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(screen.getByLabelText('Sort photos'), {
      target: { value: 'taken_asc' }
    })
    await waitFor(() =>
      expect(items).toHaveBeenLastCalledWith('a1', {
        limit: 30,
        sort: 'taken_asc',
        subject: 'sci:panthera leo',
        maxId: undefined
      })
    )
  })

  it('loads more with the cursor and does not repeat a photo', async () => {
    items.mockResolvedValue({
      items: [buildGalleryItem('a1-3'), buildGalleryItem('older')],
      nextMaxId: null
    })
    renderView(
      buildAlbumDetail({
        page: { items: [buildGalleryItem('a1-3')], nextMaxId: '2026:5' }
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(items).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ maxId: '2026:5' })
      )
    )
    const grid = await screen.findByText('older')
    expect(within(grid.closest('ul')!).getAllByRole('listitem')).toHaveLength(2)
  })

  it('collapses the species chips past five behind a +N', () => {
    const species = Array.from({ length: 7 }, (_, index) => ({
      key: `sci:${index}`,
      name: `Species ${index}`,
      count: 1
    }))
    renderView(buildAlbumDetail({ species }))
    expect(
      screen.queryByRole('button', { name: /Species 5/ })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+2' }))
    expect(
      screen.getByRole('button', { name: /Species 6/ })
    ).toBeInTheDocument()
  })

  describe('edit mode', () => {
    const enterEdit = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    it('removes a photo from the album only, and refreshes the facts', async () => {
      remove.mockResolvedValue({
        removed: ['a1-2'],
        album: buildAlbumCard('a1')
      })
      renderView(
        buildAlbumDetail({
          album: buildAlbumCard('a1', { coverMediaId: 'a1-1' })
        })
      )
      enterEdit()
      expect(screen.getByText('Cover')).toBeInTheDocument()

      const items3 = screen.getAllByRole('listitem')
      expect(items3).toHaveLength(3)
      fireEvent.click(
        screen.getAllByRole('button', { name: /^Remove .* from album$/ })[1]
      )
      await waitFor(() => expect(remove).toHaveBeenCalledWith('a1', ['a1-2']))
      await waitFor(() =>
        expect(screen.getAllByRole('listitem')).toHaveLength(2)
      )
      expect(mockRefresh).toHaveBeenCalled()
    })

    it('sets a photo as the cover', async () => {
      update.mockResolvedValue(buildAlbumCard('a1'))
      renderView()
      enterEdit()
      fireEvent.click(
        screen.getAllByRole('button', { name: /^Set .* as cover$/ })[2]
      )
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith('a1', { coverMediaId: 'a1-3' })
      )
      expect(mockRefresh).toHaveBeenCalled()
    })

    it('shows a failure and keeps the photo', async () => {
      remove.mockRejectedValue(new Error('Nope'))
      renderView()
      enterEdit()
      fireEvent.click(screen.getAllByRole('button', { name: /^Remove / })[0])
      expect(await screen.findByText('Nope')).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
    })

    it('leaves edit mode with Done and edits the details from a dialog', () => {
      renderView()
      enterEdit()
      fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
      expect(
        screen.getByRole('dialog', { name: 'dialog edit' })
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'finish' }))
      expect(mockRefresh).toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      expect(
        screen.queryByRole('button', { name: /^Remove / })
      ).not.toBeInTheDocument()
    })
  })

  it('opens the add photos dialog', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Add photos' }))
    expect(
      screen.getByRole('dialog', { name: 'dialog add' })
    ).toBeInTheDocument()
  })

  it('shows the empty state of an empty album', () => {
    renderView(
      buildAlbumDetail({
        album: buildAlbumCard('a1', {
          itemCount: 0,
          cover: null,
          previews: [],
          firstAt: null,
          lastAt: null
        }),
        species: [],
        page: { items: [], nextMaxId: null }
      })
    )
    expect(
      screen.getByRole('heading', { name: 'This album is empty' })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Sort photos')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add photos' })).toHaveLength(
      2
    )
  })

  describe('delete', () => {
    it('asks first, then deletes and goes back to the list', async () => {
      del.mockResolvedValue(undefined)
      renderView()
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      expect(del).not.toHaveBeenCalled()
      expect(screen.getByText('Delete Kruger?')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete album' }))
      })
      expect(del).toHaveBeenCalledWith('a1')
      expect(mockPush).toHaveBeenCalledWith('/gallery/albums')
    })

    it('stays on the page and says why when the delete fails', async () => {
      del.mockRejectedValue(new Error('Server down'))
      renderView()
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete album' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Server down')
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('does nothing on Cancel', () => {
      renderView()
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(del).not.toHaveBeenCalled()
    })
  })
})
