/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { getAccountGalleryAlbum } from '@/lib/client'
import {
  buildAlbumCard,
  buildAlbumView
} from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'

import { PublicGalleryAlbumView } from './PublicGalleryAlbumView'

vi.mock('@/lib/client', () => ({
  getAccountGalleryAlbum: vi.fn()
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

const load = vi.mocked(getAccountGalleryAlbum)

const PAGE_URL = 'https://activities.test/@ann@activities.test/albums/a1'

const renderView = (initial = buildAlbumView(), pageSize = 30) =>
  render(
    <PublicGalleryAlbumView
      ownerId="https://activities.test/users/ann"
      ownerName="Ann"
      profileHref="/@ann@activities.test"
      pageUrl={PAGE_URL}
      initial={initial}
      pageSize={pageSize}
    />
  )

describe('PublicGalleryAlbumView', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    load.mockReset()
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
  })

  it('shows the title, dates, country, description, facts and byline', () => {
    renderView(
      buildAlbumView({
        album: buildAlbumCard('a1', {
          title: 'Kruger',
          description: 'Eight days in the park.'
        })
      })
    )

    expect(screen.getByRole('heading', { name: 'Kruger' })).toBeInTheDocument()
    expect(
      screen.getByText('12 – 19 Sep 2026 · South Africa')
    ).toBeInTheDocument()
    expect(screen.getByText('Eight days in the park.')).toBeInTheDocument()
    expect(
      screen.getByText('3 photos · 2 species · 1 place · 1 country · 2 days')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ann' })).toHaveAttribute(
      'href',
      '/@ann@activities.test'
    )
    expect(screen.getByText(/^By/)).toBeInTheDocument()
    expect(screen.getByTestId('grid')).toHaveTextContent('a1-1')
  })

  it('has a Back link to the owner profile', () => {
    renderView()

    expect(screen.getByRole('link', { name: /^Back.*Ann$/ })).toHaveAttribute(
      'href',
      '/@ann@activities.test'
    )
  })

  it('has no owner controls: no edit, delete, share-status, hidden-places or add', () => {
    renderView()

    for (const name of [
      /edit/i,
      /delete/i,
      /add photos/i,
      /remove/i,
      /select/i,
      /make (public|private)/i
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/hidden \(threatened/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Only you see/)).not.toBeInTheDocument()
    expect(screen.queryByText(/IUCN/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Public')).not.toBeInTheDocument()
    expect(screen.queryByText('Private')).not.toBeInTheDocument()
  })

  it('copies the page address and says so', async () => {
    renderView()

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Link copied' })).toBeVisible()
    )
    expect(writeText).toHaveBeenCalledWith(PAGE_URL)
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.')
  })

  it('shows a plain heading when no photo is visible to use as a cover', () => {
    renderView(
      buildAlbumView({
        album: buildAlbumCard('a1', { title: 'No cover', cover: null })
      })
    )

    expect(
      screen.getByRole('heading', { name: 'No cover' })
    ).toBeInTheDocument()
  })

  it('shows an empty state, with no controls, for an album with no photos', () => {
    renderView(
      buildAlbumView({
        album: buildAlbumCard('a1', {
          itemCount: 0,
          cover: null,
          previews: [],
          firstAt: null,
          lastAt: null
        }),
        items: [],
        species: []
      })
    )

    expect(
      screen.getByRole('heading', { name: 'Nothing to show' })
    ).toBeInTheDocument()
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sort photos')).not.toBeInTheDocument()
  })

  describe('species filter', () => {
    it('lists the species, and filtering fetches the first page of that species', async () => {
      load.mockResolvedValue(
        buildAlbumView({
          items: [buildGalleryItem('lion-1')],
          nextMaxId: null
        })
      )
      renderView()

      const group = screen.getByRole('group', { name: 'Filter by species' })
      expect(within(group).getByRole('button', { name: /All/ })).toBeVisible()
      fireEvent.click(
        within(group).getByRole('button', { name: /African Lion/ })
      )

      await waitFor(() =>
        expect(screen.getByTestId('grid')).toHaveTextContent('lion-1')
      )
      expect(load).toHaveBeenCalledWith(
        'https://activities.test/users/ann',
        'a1',
        { limit: 30, sort: 'taken_desc', subject: 'sci:panthera leo' }
      )
      expect(
        within(group).getByRole('button', { name: /African Lion/ })
      ).toHaveAttribute('aria-pressed', 'true')
    })

    it('leaves the chips out of an album with no species', () => {
      renderView(buildAlbumView({ species: [] }))

      expect(
        screen.queryByRole('group', { name: 'Filter by species' })
      ).not.toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    it('starts at the album order and refetches in the chosen one', async () => {
      load.mockResolvedValue(
        buildAlbumView({ items: [buildGalleryItem('old-1')], nextMaxId: null })
      )
      renderView(
        buildAlbumView({
          album: buildAlbumCard('a1', { sortOrder: 'taken_desc' })
        })
      )

      const select = screen.getByLabelText('Sort photos')
      expect(select).toHaveValue('taken_desc')
      fireEvent.change(select, { target: { value: 'taken_asc' } })

      await waitFor(() =>
        expect(screen.getByTestId('grid')).toHaveTextContent('old-1')
      )
      expect(load).toHaveBeenCalledWith(
        'https://activities.test/users/ann',
        'a1',
        { limit: 30, sort: 'taken_asc', subject: undefined }
      )
    })
  })

  describe('paging', () => {
    const paged = () =>
      buildAlbumView({
        items: [buildGalleryItem('p-1'), buildGalleryItem('p-2')],
        nextMaxId: '5:2'
      })

    it('loads the next page with the cursor and appends it, without repeats', async () => {
      load.mockResolvedValue(
        buildAlbumView({
          items: [buildGalleryItem('p-2'), buildGalleryItem('p-3')],
          nextMaxId: null
        })
      )
      renderView(paged())

      fireEvent.click(screen.getByRole('button', { name: /load more/i }))

      await waitFor(() =>
        expect(screen.getByTestId('grid').children).toHaveLength(3)
      )
      expect(load).toHaveBeenCalledWith(
        'https://activities.test/users/ann',
        'a1',
        { limit: 30, sort: 'taken_desc', subject: undefined, maxId: '5:2' }
      )
      expect(
        screen.queryByRole('button', { name: /load more/i })
      ).not.toBeInTheDocument()
    })

    it('shows the failure and keeps what is there, so Load more can retry', async () => {
      load.mockRejectedValue(new Error('Rate limited'))
      renderView(paged())

      fireEvent.click(screen.getByRole('button', { name: /load more/i }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Rate limited')
      expect(screen.getByTestId('grid').children).toHaveLength(2)
      expect(
        screen.getByRole('button', { name: /load more/i })
      ).toBeInTheDocument()
    })

    it('drops a slow answer that a newer query has replaced', async () => {
      let resolveOld: (value: ReturnType<typeof buildAlbumView>) => void = () =>
        undefined
      load.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          })
      )
      load.mockResolvedValueOnce(
        buildAlbumView({ items: [buildGalleryItem('new-1')], nextMaxId: null })
      )
      renderView(paged())

      const select = screen.getByLabelText('Sort photos')
      fireEvent.change(select, { target: { value: 'taken_asc' } })
      fireEvent.change(select, { target: { value: 'added_desc' } })
      await waitFor(() =>
        expect(screen.getByTestId('grid')).toHaveTextContent('new-1')
      )

      resolveOld(
        buildAlbumView({
          items: [buildGalleryItem('stale-1')],
          nextMaxId: null
        })
      )
      await Promise.resolve()

      expect(screen.getByTestId('grid')).not.toHaveTextContent('stale-1')
    })
  })
})
