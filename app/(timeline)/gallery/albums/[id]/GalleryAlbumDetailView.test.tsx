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
  GalleryGrid: ({
    items,
    albumsOwnerId,
    onAlbumsChanged
  }: {
    items: { mediaId: string }[]
    albumsOwnerId?: string | null
    onAlbumsChanged?: (albumIds: string[]) => void
  }) => (
    <div>
      <ul data-testid="grid" data-albums-owner={albumsOwnerId ?? 'none'}>
        {items.map((item) => (
          <li key={item.mediaId}>{item.mediaId}</li>
        ))}
      </ul>
      {/* What the grid does when its viewer closes after a pill change. */}
      <button onClick={() => onAlbumsChanged?.(['a1'])}>
        viewer closed after changing this album
      </button>
      <button onClick={() => onAlbumsChanged?.(['elsewhere'])}>
        viewer closed after changing another album
      </button>
    </div>
  )
}))

vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog', () => ({
  GalleryAlbumFormDialog: ({
    intent,
    existingMediaIds,
    onSaved
  }: {
    intent: string
    existingMediaIds?: string[]
    onSaved: (id: string) => void
  }) => (
    <div role="dialog" aria-label={`dialog ${intent}`}>
      <span data-testid="existing">{existingMediaIds?.join(',')}</span>
      <button onClick={() => onSaved('a1')}>finish</button>
    </div>
  )
}))

const items = vi.mocked(getGalleryAlbumItems)
const remove = vi.mocked(removeGalleryAlbumItems)
const update = vi.mocked(updateGalleryAlbum)
const del = vi.mocked(deleteGalleryAlbum)

const SHARE_URL = 'https://activities.test/@owner@activities.test/albums/a1'

const renderView = (detail = buildAlbumDetail()) =>
  render(
    <GalleryAlbumDetailView
      ownerId="owner"
      shareUrl={SHARE_URL}
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

  it('shows a private album as private, with the same public-safe note', () => {
    renderView(
      buildAlbumDetail({
        album: buildAlbumCard('a1', { visibility: 'private' })
      })
    )
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(
      screen.getByText(/Counts include only photos from public posts/)
    ).toBeInTheDocument()
  })

  describe('Share link', () => {
    const writeText = vi.fn()

    beforeEach(() => {
      writeText.mockReset()
      writeText.mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText }
      })
    })

    it('copies the public address of a public album and says so', async () => {
      renderView()

      fireEvent.click(screen.getByRole('button', { name: 'Share link' }))

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Link copied' })
        ).toBeVisible()
      )
      expect(writeText).toHaveBeenCalledWith(SHARE_URL)
      expect(screen.getByRole('status')).toHaveTextContent('Link copied.')
      // Nothing to explain for a public album with photos visitors can see.
      expect(
        screen.queryByText(/Make this album public/)
      ).not.toBeInTheDocument()
    })

    it('is inert for a private album, but still focusable and described by a visible hint', () => {
      renderView(
        buildAlbumDetail({
          album: buildAlbumCard('a1', { visibility: 'private' })
        })
      )

      const share = screen.getByRole('button', { name: 'Share link' })
      expect(share).toHaveAttribute('aria-disabled', 'true')
      expect(share).not.toBeDisabled()
      // The reason is text on the page, not a tooltip, and the button points
      // at it, so keyboard and touch users get it too.
      expect(share).toHaveAccessibleDescription(
        'Make this album public to share its link.'
      )
      expect(
        screen.getByText('Make this album public to share its link.')
      ).toBeVisible()
      share.focus()
      expect(share).toHaveFocus()

      fireEvent.click(share)
      expect(writeText).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('button', { name: 'Link copied' })
      ).not.toBeInTheDocument()
    })

    it('warns that a public album with no public photo is not found for signed-out viewers and non-followers', async () => {
      renderView(
        buildAlbumDetail({
          facts: { ...buildAlbumDetail().facts, photoCount: 0 }
        })
      )

      const share = screen.getByRole('button', { name: 'Share link' })
      expect(share).not.toHaveAttribute('aria-disabled', 'true')
      expect(share).toHaveAccessibleDescription(
        'No photo here is public yet, so anyone signed out (and anyone who does not follow you) sees a not-found page.'
      )
      fireEvent.click(share)
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE_URL))
    })
  })

  it('keeps the sort a 40px touch target', () => {
    renderView()
    expect(screen.getByLabelText('Sort photos')).toHaveClass(
      'pointer-coarse:h-10'
    )
  })

  it('keeps the counts note for the owner, who sees every photo', () => {
    renderView()
    expect(
      screen.getByText(/Counts include only photos from public posts/)
    ).toBeInTheDocument()
  })

  it('shows the cover at full size, not as its small thumbnail', () => {
    const { container } = renderView()
    const hero = container.querySelector('img')
    expect(hero).toHaveAttribute(
      'src',
      'https://activities.local/media/a1-1.jpg'
    )
  })

  it('keeps the thumbnail for an animated GIF cover', () => {
    const gif = buildGalleryItem('gif-1', {
      attachment: {
        ...buildGalleryItem('gif-1').attachment,
        mediaType: 'image/gif',
        url: 'https://activities.local/media/gif-1.gif'
      }
    })
    const { container } = renderView(
      buildAlbumDetail({
        album: buildAlbumCard('a1', { cover: gif, previews: [gif] })
      })
    )
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://activities.local/media/gif-1-thumb.jpg'
    )
  })

  describe('the lightbox albums pill', () => {
    it('gives the grid the owner, so the lightbox shows the pill', () => {
      renderView()

      expect(screen.getByTestId('grid')).toHaveAttribute(
        'data-albums-owner',
        'owner'
      )
    })

    it('reads the album again when the viewer closes after the pill changed this album', async () => {
      items.mockResolvedValue({
        items: [buildGalleryItem('a1-1')],
        nextMaxId: null
      })
      renderView()
      expect(mockRefresh).not.toHaveBeenCalled()

      fireEvent.click(
        screen.getByRole('button', {
          name: 'viewer closed after changing this album'
        })
      )

      // The facts and count (server render) and the grid.
      await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(items).toHaveBeenCalledWith('a1', {
          limit: 30,
          sort: 'taken_desc',
          subject: undefined,
          maxId: undefined
        })
      )
      await waitFor(() =>
        expect(screen.getByTestId('grid')).toHaveTextContent('a1-1')
      )
      expect(screen.getByTestId('grid')).not.toHaveTextContent('a1-2')
    })

    it('leaves the page alone when the pill changed some other album', async () => {
      renderView()

      fireEvent.click(
        screen.getByRole('button', {
          name: 'viewer closed after changing another album'
        })
      )
      await act(async () => {})

      expect(mockRefresh).not.toHaveBeenCalled()
      expect(items).not.toHaveBeenCalled()
    })
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

  describe('when a reload fails', () => {
    const paged = () =>
      buildAlbumDetail({
        page: {
          items: [buildGalleryItem('a1-1'), buildGalleryItem('a1-2')],
          nextMaxId: '5:2'
        }
      })

    it('puts the sort back, so Load more keeps the cursor of the order on screen', async () => {
      items.mockRejectedValueOnce(new Error('Rate limited'))
      items.mockResolvedValueOnce({
        items: [buildGalleryItem('a1-3')],
        nextMaxId: null
      })
      renderView(paged())

      const select = screen.getByLabelText('Sort photos')
      fireEvent.change(select, { target: { value: 'taken_asc' } })

      expect(await screen.findByRole('alert')).toHaveTextContent('Rate limited')
      expect(select).toHaveValue('taken_desc')
      expect(screen.getByTestId('grid').children).toHaveLength(2)

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      await waitFor(() =>
        expect(screen.getByTestId('grid').children).toHaveLength(3)
      )
      expect(items).toHaveBeenLastCalledWith('a1', {
        limit: 30,
        sort: 'taken_desc',
        subject: undefined,
        maxId: '5:2'
      })
    })

    it('puts the species back', async () => {
      items.mockRejectedValueOnce(new Error('Offline'))
      renderView(paged())

      fireEvent.click(screen.getByRole('button', { name: /African Lion\s*2/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
      expect(
        screen.getByRole('button', { name: /African Lion\s*2/ })
      ).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByTestId('grid').children).toHaveLength(2)
    })

    it('drops the cursor, and does not ask again, when a filter that has gone cannot be reloaded', async () => {
      items.mockResolvedValue({
        items: [buildGalleryItem('lion-1')],
        nextMaxId: '7:7'
      })
      const withLion = buildAlbumDetail({
        species: [{ key: 'sci:panthera leo', name: 'African Lion', count: 1 }]
      })
      const { rerender } = renderView(withLion)
      fireEvent.click(screen.getByRole('button', { name: /African Lion\s*1/ }))
      expect(await screen.findByText('lion-1')).toBeInTheDocument()

      items.mockReset()
      items.mockRejectedValue(new Error('Offline'))
      rerender(
        <GalleryAlbumDetailView
          ownerId="owner"
          shareUrl={SHARE_URL}
          detail={buildAlbumDetail({ species: [] })}
          pageSize={30}
        />
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Load more' })
        ).not.toBeInTheDocument()
      )
      expect(items).toHaveBeenCalledTimes(1)
    })
  })

  it('drops a species filter whose last photo was removed, even with no chips left', async () => {
    items.mockResolvedValue({
      items: [buildGalleryItem('lion-1')],
      nextMaxId: null
    })
    const withLion = buildAlbumDetail({
      species: [{ key: 'sci:panthera leo', name: 'African Lion', count: 1 }]
    })
    const { rerender } = renderView(withLion)
    fireEvent.click(screen.getByRole('button', { name: /African Lion\s*1/ }))
    await waitFor(() =>
      expect(items).toHaveBeenLastCalledWith(
        'a1',
        expect.objectContaining({ subject: 'sci:panthera leo' })
      )
    )

    // The lion photo was removed: the refreshed page has no species at all.
    items.mockResolvedValue({
      items: [buildGalleryItem('a1-2')],
      nextMaxId: null
    })
    rerender(
      <GalleryAlbumDetailView
        ownerId="owner"
        shareUrl={SHARE_URL}
        detail={buildAlbumDetail({ species: [] })}
        pageSize={30}
      />
    )

    await waitFor(() =>
      expect(items).toHaveBeenLastCalledWith(
        'a1',
        expect.objectContaining({ subject: undefined })
      )
    )
    expect(await screen.findByTestId('grid')).toHaveTextContent('a1-2')
    expect(
      screen.queryByText('No photos in this view.')
    ).not.toBeInTheDocument()
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

    it('gives photos with the same name different button names', () => {
      const same = ['x1', 'x2', 'x3'].map((id) =>
        buildGalleryItem(id, {
          subject: {
            name: 'Common kingfisher'
          } as never
        })
      )
      renderView(
        buildAlbumDetail({
          album: buildAlbumCard('a1', { previews: same, cover: same[0] }),
          page: { items: same, nextMaxId: null }
        })
      )
      enterEdit()

      const names = screen
        .getAllByRole('button', { name: /^Remove / })
        .map((button) => button.getAttribute('aria-label'))
      expect(new Set(names).size).toBe(3)
      expect(names[1]).toBe('Remove Common kingfisher, photo 2 from album')
      // The first is the implicit cover, so it offers to keep it instead.
      const covers = screen
        .getAllByRole('button', { name: /as cover$/ })
        .map((button) => button.getAttribute('aria-label'))
      expect(covers).toHaveLength(3)
      expect(new Set(covers).size).toBe(3)
    })

    it('moves focus to the next photo and announces the removal', async () => {
      remove.mockResolvedValue({
        removed: ['a1-2'],
        album: buildAlbumCard('a1')
      })
      renderView()
      enterEdit()

      fireEvent.click(
        screen.getAllByRole('button', { name: /^Remove .* from album$/ })[1]
      )

      await waitFor(() =>
        expect(screen.getAllByRole('listitem')).toHaveLength(2)
      )
      const remaining = screen.getAllByRole('button', { name: /^Remove / })
      await waitFor(() => expect(remaining[1]).toHaveFocus())
      expect(screen.getByRole('status')).toHaveTextContent(
        'Removed Photo 2 from the album.'
      )
    })

    it('moves focus to the previous photo after removing the last one', async () => {
      remove.mockResolvedValue({
        removed: ['a1-3'],
        album: buildAlbumCard('a1')
      })
      renderView()
      enterEdit()

      fireEvent.click(
        screen.getAllByRole('button', { name: /^Remove .* from album$/ })[2]
      )

      await waitFor(() =>
        expect(screen.getAllByRole('listitem')).toHaveLength(2)
      )
      await waitFor(() =>
        expect(
          screen.getAllByRole('button', { name: /^Remove / })[1]
        ).toHaveFocus()
      )
    })

    it('sets a photo as the cover', async () => {
      update.mockResolvedValue(buildAlbumCard('a1'))
      renderView()
      enterEdit()
      fireEvent.click(
        screen.getAllByRole('button', { name: /^Set .* as cover$/ })[1]
      )
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith('a1', { coverMediaId: 'a1-3' })
      )
      expect(mockRefresh).toHaveBeenCalled()
    })

    it('marks the hero photo as the cover when none was chosen', () => {
      renderView(
        buildAlbumDetail({
          album: buildAlbumCard('a1', { coverMediaId: null })
        })
      )
      enterEdit()

      // a1-1 is the hero (the newest photo): it is marked, and the others are
      // not.
      const marked = screen.getByTestId('album-cover-marker-pin')
      expect(marked).toHaveAccessibleName('Keep Photo 1 as cover')
      expect(marked).toHaveTextContent('Cover')
      expect(screen.getAllByTestId('album-set-cover')).toHaveLength(2)
      expect(screen.queryByTestId('album-cover-marker')).not.toBeInTheDocument()

      // The marker still pins it, so the choice survives a newer photo.
      fireEvent.click(marked)
      expect(update).toHaveBeenCalledWith('a1', { coverMediaId: 'a1-1' })
    })

    it('tells the chosen cover from the Set as cover buttons', () => {
      renderView(
        buildAlbumDetail({
          album: buildAlbumCard('a1', {
            coverMediaId: 'a1-2',
            cover: buildGalleryItem('a1-2')
          })
        })
      )
      enterEdit()

      const marker = screen.getByTestId('album-cover-marker')
      expect(marker).toHaveTextContent('Cover')
      expect(marker.tagName).toBe('SPAN')
      expect(marker.querySelector('svg')).toHaveClass('fill-current')

      // The others are buttons that keep their full accessible name even where
      // the label is hidden, with an outline star.
      const buttons = screen.getAllByTestId('album-set-cover')
      expect(buttons).toHaveLength(2)
      expect(buttons[0]).toHaveAccessibleName('Set Photo 1 as cover')
      expect(buttons[1]).toHaveAccessibleName('Set Photo 3 as cover')
      for (const button of buttons) {
        expect(button.querySelector('svg')).not.toHaveClass('fill-current')
        expect(button).not.toBe(marker)
      }
      expect(screen.getAllByText('Cover')).toHaveLength(1)
    })

    it('moves focus to the new cover tile after Set as cover', async () => {
      update.mockResolvedValue(buildAlbumCard('a1'))
      renderView(
        buildAlbumDetail({
          album: buildAlbumCard('a1', { coverMediaId: 'a1-1' })
        })
      )
      enterEdit()

      fireEvent.click(
        screen.getByRole('button', { name: 'Set Photo 3 as cover' })
      )

      await waitFor(() =>
        expect(update).toHaveBeenCalledWith('a1', { coverMediaId: 'a1-3' })
      )
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Remove Photo 3 from album' })
        ).toHaveFocus()
      )
      expect(screen.getByRole('status')).toHaveTextContent(
        'Photo 3 is now the cover.'
      )
    })

    it('shows a failure and keeps the photo', async () => {
      remove.mockRejectedValue(new Error('Nope'))
      renderView()
      enterEdit()
      fireEvent.click(screen.getAllByRole('button', { name: /^Remove / })[0])
      expect(await screen.findByText('Nope')).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
    })

    it('names the toggle Edit or Done without also saying pressed', () => {
      renderView()
      const toggle = screen.getByRole('button', { name: 'Edit' })
      expect(toggle).not.toHaveAttribute('aria-pressed')
      fireEvent.click(toggle)
      expect(screen.getByRole('button', { name: 'Done' })).not.toHaveAttribute(
        'aria-pressed'
      )
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

  it('opens the add photos dialog with the photos already in the album', () => {
    renderView(buildAlbumDetail({ mediaIds: ['a1-1', 'a1-2', 'a1-3'] }))
    fireEvent.click(screen.getByRole('button', { name: 'Add photos' }))
    expect(
      screen.getByRole('dialog', { name: 'dialog add' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('existing')).toHaveTextContent('a1-1,a1-2,a1-3')
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
      expect(screen.queryByText(/its link/)).not.toBeInTheDocument()

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
