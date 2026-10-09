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
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getGalleryMedia } from '@/lib/client'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import { GALLERY_ALBUM_FULL_MESSAGE } from '@/lib/types/database/galleryAlbums'

import { GalleryRecentView } from './GalleryRecentView'

enableFetchMocks()

// The album helpers are the real ones (over a mocked fetch), so batching of the
// add is exercised through the view.
vi.mock('@/lib/client', async () => {
  const albums = await vi.importActual<
    typeof import('@/lib/client/galleryAlbums')
  >('@/lib/client/galleryAlbums')
  return {
    getGalleryMedia: vi.fn(),
    getGalleryAlbums: albums.getGalleryAlbums,
    addGalleryAlbumItems: albums.addGalleryAlbumItems,
    GalleryAlbumAddError: albums.GalleryAlbumAddError
  }
})

vi.mock('next/link', () => ({
  default: ({
    href,
    children
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>
}))

const formDialog = vi.hoisted(() => ({
  current: null as null | {
    open: boolean
    initialMediaIds?: string[]
    initialItems?: { mediaId: string }[]
    onOpenChange: (open: boolean) => void
    onSaved: (albumId: string) => void
  }
}))

vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog', () => ({
  GalleryAlbumFormDialog: (props: NonNullable<typeof formDialog.current>) => {
    formDialog.current = props
    return props.open ? <div role="dialog" aria-label="New album" /> : null
  }
}))

vi.mock('@/lib/components/gallery/GalleryGrid', () => ({
  GalleryGrid: ({
    items,
    selection
  }: {
    items: { mediaId: string }[]
    selection?: {
      selected: ReadonlySet<string>
      onToggle: (item: { mediaId: string }) => void
    }
  }) => (
    <ul data-testid="grid" data-selecting={selection ? 'yes' : 'no'}>
      {items.map((item) => (
        <li key={item.mediaId}>
          {selection ? (
            <button
              type="button"
              aria-pressed={selection.selected.has(item.mediaId)}
              onClick={() => selection.onToggle(item)}
            >
              Select {item.mediaId}
            </button>
          ) : (
            item.mediaId
          )}
        </li>
      ))}
    </ul>
  )
}))

const getGalleryMediaMock = getGalleryMedia as jest.Mock

describe('GalleryRecentView', () => {
  beforeEach(() => {
    getGalleryMediaMock.mockReset()
    fetchMock.resetMocks()
    formDialog.current = null
  })

  it('renders the server page without fetching', () => {
    render(
      <GalleryRecentView
        actorId="actor-1"
        initialCategory={null}
        initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
      />
    )
    expect(screen.getByTestId('grid')).toHaveTextContent('5')
    expect(getGalleryMediaMock).not.toHaveBeenCalled()
  })

  it('starts on the category from the URL', () => {
    render(
      <GalleryRecentView
        actorId="actor-1"
        initialCategory="bird"
        initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
      />
    )
    expect(
      screen.getByRole('navigation', { name: 'Category' })
    ).toHaveTextContent('Birds')
  })

  it('reloads from the first page when the category changes', async () => {
    getGalleryMediaMock.mockResolvedValue({
      items: [buildGalleryItem('8')],
      nextMaxId: null
    })
    render(
      <GalleryRecentView
        actorId="actor-1"
        initialCategory={null}
        initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
      />
    )

    const nav = screen.getByRole('navigation', { name: 'Category' })
    fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mammals' }))

    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('8')
    )
    expect(screen.getByTestId('grid')).not.toHaveTextContent('5')
    expect(getGalleryMediaMock).toHaveBeenCalledWith('actor-1', {
      limit: 30,
      maxId: undefined,
      subject: undefined,
      category: 'mammal'
    })
  })

  describe('select mode', () => {
    const photos = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        buildGalleryItem(String(index + 1))
      )

    const renderRecent = (count = 3) =>
      render(
        <GalleryRecentView
          actorId="actor-1"
          initialCategory={null}
          initialPage={{ items: photos(count), nextMaxId: null }}
        />
      )

    const albums = [
      buildAlbumCard('a1', { title: 'Kruger', itemCount: 4 }),
      buildAlbumCard('a2', { title: 'Garden birds', itemCount: 1 })
    ]

    const answerWith = (
      add: (ids: string[], album: string) => { status?: number; body: unknown }
    ) =>
      fetchMock.mockResponse(async (request) => {
        const url = new URL(request.url, 'http://localhost')
        if (request.method === 'GET') {
          return JSON.stringify({ albums, photoCount: 5 })
        }
        const album = url.pathname.split('/')[5]
        const body = (await request.json()) as { media_ids: string[] }
        const answer = add(body.media_ids, album)
        return {
          status: answer.status ?? 200,
          body: JSON.stringify(answer.body)
        }
      })

    const accepted = (ids: string[], album = albums[0]) => ({
      body: { added: ids, existing: [], skipped: [], album }
    })

    const startSelecting = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    it('is off until Select is pressed, and has no bar', () => {
      renderRecent()

      expect(screen.getByTestId('grid')).toHaveAttribute('data-selecting', 'no')
      expect(
        screen.queryByRole('region', { name: 'Selection' })
      ).not.toBeInTheDocument()

      startSelecting()

      expect(screen.getByTestId('grid')).toHaveAttribute(
        'data-selecting',
        'yes'
      )
      // The label says which mode it is in; a pressed state on top of a
      // changing label would say it twice.
      expect(
        screen.getByRole('button', { name: 'Cancel' })
      ).not.toHaveAttribute('aria-pressed')
      expect(screen.getByText(/Select mode is on/)).toBeInTheDocument()
      const bar = screen.getByRole('region', { name: 'Selection' })
      expect(bar).toHaveTextContent('0 selected')
      expect(
        within(bar).getByRole('button', { name: 'Add to album' })
      ).toHaveAttribute('aria-disabled', 'true')
    })

    it('sends focus to the bar from a skip link', () => {
      renderRecent()
      expect(
        screen.queryByRole('button', { name: 'Skip to selection bar' })
      ).not.toBeInTheDocument()
      startSelecting()

      fireEvent.click(
        screen.getByRole('button', { name: 'Skip to selection bar' })
      )

      expect(screen.getByRole('region', { name: 'Selection' })).toHaveFocus()
    })

    it('counts the picks and turns a pick off again', () => {
      renderRecent()
      startSelecting()

      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Select 3' }))
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('2 selected')

      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('1 selected')
    })

    it('selects every loaded photo, and clears', () => {
      renderRecent(3)
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 2' }))

      fireEvent.click(screen.getByRole('button', { name: 'Select all loaded' }))
      const bar = screen.getByRole('region', { name: 'Selection' })
      expect(bar).toHaveTextContent('3 selected')
      // Spent, but still the focused button: it is not natively disabled.
      const selectAll = within(bar).getByRole('button', {
        name: 'Select all loaded'
      })
      expect(selectAll).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(selectAll)
      expect(bar).toHaveTextContent('3 selected')

      const clear = within(bar).getByRole('button', { name: 'Clear' })
      clear.focus()
      fireEvent.click(clear)
      expect(bar).toHaveTextContent('0 selected')
      expect(clear).toHaveAttribute('aria-disabled', 'true')
      expect(clear).toHaveFocus()
      fireEvent.click(clear)
      expect(bar).toHaveTextContent('0 selected')
    })

    it('leaves select mode and forgets the picks on Cancel', () => {
      renderRecent()
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(
        screen.queryByRole('region', { name: 'Selection' })
      ).not.toBeInTheDocument()

      startSelecting()
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('0 selected')
    })

    it('forgets the picks when the category changes', async () => {
      getGalleryMediaMock.mockResolvedValue({
        items: [buildGalleryItem('8')],
        nextMaxId: null
      })
      renderRecent()
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))

      const nav = screen.getByRole('navigation', { name: 'Category' })
      fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Mammals' }))

      await screen.findByRole('button', { name: 'Select 8' })
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('0 selected')
    })

    it('adds the selection to an album in the order picked and links to it', async () => {
      answerWith((ids) => accepted(ids))
      renderRecent()
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 3' }))
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))

      fireEvent.click(
        within(screen.getByRole('region', { name: 'Selection' })).getByRole(
          'button',
          { name: 'Add to album' }
        )
      )
      fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add 2 photos' }))

      const status = await screen.findByText(/Added 2 photos to “Kruger”/)
      expect(
        within(status.closest('div')!).getByRole('link', { name: 'Open album' })
      ).toHaveAttribute('href', '/gallery/albums/a1')
      const posts = fetchMock.mock.calls.filter(
        ([, init]) => init?.method === 'POST'
      )
      expect(posts).toHaveLength(1)
      expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
        media_ids: ['3', '1']
      })
      // Done: the mode is left.
      expect(
        screen.queryByRole('region', { name: 'Selection' })
      ).not.toBeInTheDocument()
    })

    it('sends a large selection in batches of 100', async () => {
      const sent: string[][] = []
      answerWith((ids) => {
        sent.push(ids)
        return accepted(ids)
      })
      renderRecent(250)
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select all loaded' }))
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('250 selected')

      fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
      fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add 250 photos' }))

      await screen.findByText(/Added 250 photos to “Kruger”/)
      expect(sent.map((batch) => batch.length)).toEqual([100, 100, 50])
    })

    it('says how far a large add got when the album fills up', async () => {
      let calls = 0
      answerWith((ids) => {
        calls += 1
        return calls === 1
          ? accepted(ids)
          : { status: 422, body: { error: GALLERY_ALBUM_FULL_MESSAGE } }
      })
      renderRecent(250)
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select all loaded' }))

      fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
      fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add 250 photos' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        '“Kruger” is full: an album holds at most 2,000 photos. Added 100 of 250. The other 150 photos were not added.'
      )
      // The selection is kept so the owner can choose another album.
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('250 selected')
    })

    it('keeps earlier batches and says so when a later batch fails', async () => {
      let calls = 0
      answerWith((ids) => {
        calls += 1
        return calls === 1
          ? accepted(ids)
          : { status: 500, body: { error: 'Server is down' } }
      })
      renderRecent(250)
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select all loaded' }))

      fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
      fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add 250 photos' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Couldn’t finish adding to “Kruger”. Server is down. Added 100 of 250. The other 150 photos were not added.'
      )
      // Not the full-album wording, and the selection is kept for a retry.
      expect(screen.getByRole('alert')).not.toHaveTextContent('is full')
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('250 selected')
    })

    it('hands focus to the Select button when an add finishes', async () => {
      answerWith((ids) => accepted(ids))
      renderRecent()
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
      fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add 1 photo' }))
      await screen.findByText(/Added 1 photo to “Kruger”/)

      // The bar that had focus is gone with select mode.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Select' })).toHaveFocus()
      )
      // The result is in a status region that was on the page already.
      expect(
        screen.getByText(/Added 1 photo to “Kruger”/).closest('[role="status"]')
      ).toBeInTheDocument()
    })

    it('reports photos the server skipped', async () => {
      answerWith((ids) => ({
        body: {
          added: ids.slice(0, 1),
          existing: [],
          skipped: ids.slice(1),
          album: albums[0]
        }
      }))
      renderRecent()
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select all loaded' }))

      fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
      fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add 3 photos' }))

      expect(
        await screen.findByText(
          /Added 1 photo to “Kruger”\. 2 photos couldn’t be added/
        )
      ).toBeVisible()
    })

    it('opens the create dialog with the selection and its photos', async () => {
      answerWith((ids) => accepted(ids))
      renderRecent()
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 2' }))
      fireEvent.click(screen.getByRole('button', { name: 'Select 3' }))

      fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'New album with these photos'
        })
      )

      expect(
        await screen.findByRole('dialog', { name: 'New album' })
      ).toBeVisible()
      expect(formDialog.current?.initialMediaIds).toEqual(['2', '3'])
      expect(formDialog.current?.initialItems?.map((i) => i.mediaId)).toEqual([
        '2',
        '3'
      ])

      await act(async () => formDialog.current?.onSaved('new-album'))

      const status = await screen.findByText('Album created.', {
        exact: false
      })
      expect(
        within(status.closest('div')!).getByRole('link', { name: 'Open album' })
      ).toHaveAttribute('href', '/gallery/albums/new-album')
      expect(
        screen.queryByRole('region', { name: 'Selection' })
      ).not.toBeInTheDocument()
    })

    it('dismisses the result', async () => {
      answerWith((ids) => accepted(ids))
      renderRecent()
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
      fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add 1 photo' }))
      await screen.findByText(/Added 1 photo to “Kruger”/)

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

      await waitFor(() =>
        expect(screen.queryByText(/Added 1 photo/)).not.toBeInTheDocument()
      )
    })
  })
})
