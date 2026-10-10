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

import { GalleryAllMediaView } from './GalleryAllMediaView'

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

const editDialog = vi.hoisted(() => ({
  current: null as null | {
    items: { mediaId: string }[]
    initialMediaId: string
    ownerId: string
    onClose: () => void
    onSaved: (items: unknown[]) => void
  }
}))

vi.mock('@/lib/components/gallery/GalleryEditDetailsDialog', () => ({
  GalleryEditDetailsDialog: (props: NonNullable<typeof editDialog.current>) => {
    editDialog.current = props
    return <div role="dialog" aria-label="Edit details" />
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

describe('GalleryAllMediaView', () => {
  beforeEach(() => {
    getGalleryMediaMock.mockReset()
    fetchMock.resetMocks()
    formDialog.current = null
    editDialog.current = null
  })

  it('renders the server page without fetching', () => {
    render(
      <GalleryAllMediaView
        actorId="actor-1"
        initialCategory={null}
        initialShow="all"
        initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
      />
    )
    expect(screen.getByTestId('grid')).toHaveTextContent('5')
    expect(getGalleryMediaMock).not.toHaveBeenCalled()
  })

  it('starts on the category from the URL', () => {
    render(
      <GalleryAllMediaView
        actorId="actor-1"
        initialCategory="bird"
        initialShow="all"
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
      <GalleryAllMediaView
        actorId="actor-1"
        initialCategory={null}
        initialShow="all"
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
      category: 'mammal',
      show: 'all'
    })
  })

  it('loads fresh instead of reusing the server page after the filters were left', async () => {
    getGalleryMediaMock.mockResolvedValue({
      items: [buildGalleryItem('5', { inGallery: false })],
      nextMaxId: null
    })
    render(
      <GalleryAllMediaView
        actorId="actor-1"
        initialCategory={null}
        initialShow="in_gallery"
        initialPage={{
          items: [buildGalleryItem('5', { inGallery: true })],
          nextMaxId: null
        }}
      />
    )
    expect(getGalleryMediaMock).not.toHaveBeenCalled()

    const chooseShow = async (label: RegExp) => {
      const group = screen.getByRole('group', { name: 'Show' })
      fireEvent.keyDown(group.querySelector('button')!, { key: 'ArrowDown' })
      fireEvent.click(await screen.findByRole('menuitem', { name: label }))
    }
    await chooseShow(/^Everything/)
    await waitFor(() => expect(getGalleryMediaMock).toHaveBeenCalledTimes(1))
    await chooseShow(/^In gallery/)

    // Back on the starting list: not the page the server rendered before the
    // photo was edited, but a new read.
    await waitFor(() => expect(getGalleryMediaMock).toHaveBeenCalledTimes(2))
    expect(getGalleryMediaMock).toHaveBeenLastCalledWith(
      'actor-1',
      expect.objectContaining({ show: 'in_gallery' })
    )
  })

  it('titles the page All media', () => {
    render(
      <GalleryAllMediaView
        actorId="actor-1"
        initialCategory={null}
        initialShow="all"
        initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'All media' })
    ).toBeInTheDocument()
    expect(
      screen.getByText("Every photo and video you've posted, newest first")
    ).toBeInTheDocument()
  })

  describe('show filter', () => {
    const openShowMenu = async () => {
      const nav = screen.getByRole('group', { name: 'Show' })
      fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
      return screen.findByRole('menu')
    }

    it('starts on the list from the URL, Everything by default', () => {
      const { unmount } = render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
        />
      )
      expect(screen.getByRole('group', { name: 'Show' })).toHaveTextContent(
        'Show Everything'
      )
      unmount()

      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="hidden"
          initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
        />
      )
      expect(screen.getByRole('group', { name: 'Show' })).toHaveTextContent(
        'Show Hidden from gallery'
      )
    })

    it('offers the three lists with a hint each', async () => {
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
        />
      )
      const menu = await openShowMenu()
      const items = within(menu).getAllByRole('menuitem')
      expect(items.map((item) => item.textContent)).toEqual([
        'EverythingPhotos and videos you’ve posted',
        'In galleryPosted and shown in your gallery',
        'Hidden from galleryPosted, with Show in my gallery switched off'
      ])
      expect(items[0]).toHaveAttribute('aria-current', 'true')
    })

    it.each([
      {
        description: 'in the gallery',
        label: /^In gallery/,
        show: 'in_gallery'
      },
      {
        description: 'hidden from the gallery',
        label: /^Hidden from gallery/,
        show: 'hidden'
      }
    ])(
      'reloads from the first page for $description',
      async ({ label, show }) => {
        getGalleryMediaMock.mockResolvedValue({
          items: [buildGalleryItem('8')],
          nextMaxId: null
        })
        render(
          <GalleryAllMediaView
            actorId="actor-1"
            initialCategory="bird"
            initialShow="all"
            initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
          />
        )

        await openShowMenu()
        fireEvent.click(await screen.findByRole('menuitem', { name: label }))

        await waitFor(() =>
          expect(screen.getByTestId('grid')).toHaveTextContent('8')
        )
        expect(getGalleryMediaMock).toHaveBeenCalledWith('actor-1', {
          limit: 30,
          maxId: undefined,
          subject: undefined,
          category: 'bird',
          show
        })
      }
    )

    it('says what an empty list means', async () => {
      getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
        />
      )

      await openShowMenu()
      fireEvent.click(
        await screen.findByRole('menuitem', { name: /^Hidden from gallery/ })
      )

      expect(
        await screen.findByText('Nothing is hidden from your gallery')
      ).toBeInTheDocument()
    })
  })

  describe('select mode', () => {
    const photos = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        buildGalleryItem(String(index + 1))
      )

    const renderAllMedia = (count = 3) =>
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
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
      renderAllMedia()

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
      renderAllMedia()
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
      renderAllMedia()
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
      renderAllMedia(3)
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
      renderAllMedia()
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
      renderAllMedia()
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
      renderAllMedia()
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
      renderAllMedia(250)
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
      renderAllMedia(250)
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
      renderAllMedia(250)
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
      renderAllMedia()
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
      renderAllMedia()
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
      renderAllMedia()
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

    it('opens Edit details with the selected photos and reports the save', async () => {
      renderAllMedia(3)
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 3' }))
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))

      fireEvent.click(
        within(screen.getByRole('region', { name: 'Selection' })).getByRole(
          'button',
          { name: 'Edit details' }
        )
      )

      expect(
        await screen.findByRole('dialog', { name: 'Edit details' })
      ).toBeVisible()
      // Newest first, as the grid lists them.
      expect(editDialog.current?.items.map((i) => i.mediaId)).toEqual([
        '1',
        '3'
      ])
      expect(editDialog.current?.ownerId).toBe('actor-1')

      await act(async () =>
        editDialog.current?.onSaved([
          buildGalleryItem('1'),
          buildGalleryItem('3')
        ])
      )
      await act(async () => editDialog.current?.onClose())

      expect(
        screen.queryByRole('dialog', { name: 'Edit details' })
      ).not.toBeInTheDocument()
      expect(screen.getByText('Details saved for 2 items.')).toBeVisible()
      // Select mode and the picks stay, for a follow-up like Add to album.
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('2 selected')
    })

    it('does nothing from Edit details until a photo is picked', () => {
      renderAllMedia()
      startSelecting()

      const edit = within(
        screen.getByRole('region', { name: 'Selection' })
      ).getByRole('button', { name: 'Edit details' })
      expect(edit).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(edit)

      expect(
        screen.queryByRole('dialog', { name: 'Edit details' })
      ).not.toBeInTheDocument()
    })

    describe('hidden photos', () => {
      const mixed = () => [
        buildGalleryItem('1', { inGallery: true }),
        buildGalleryItem('2', { inGallery: false }),
        buildGalleryItem('3', { inGallery: false }),
        buildGalleryItem('4', { inGallery: true })
      ]
      const renderMixed = (show: 'all' | 'in_gallery' = 'all') =>
        render(
          <GalleryAllMediaView
            actorId="actor-1"
            initialCategory={null}
            initialShow={show}
            initialPage={{ items: mixed(), nextMaxId: null }}
          />
        )
      const bar = () => screen.getByRole('region', { name: 'Selection' })
      const pick = (...ids: string[]) =>
        ids.forEach((id) =>
          fireEvent.click(screen.getByRole('button', { name: `Select ${id}` }))
        )

      it('turns Add to album off while only hidden photos are selected', () => {
        renderMixed()
        startSelecting()
        pick('2', '3')

        const add = within(bar()).getByRole('button', { name: 'Add to album' })
        expect(add).toHaveAttribute('aria-disabled', 'true')
        expect(bar()).toHaveTextContent(
          'Hidden photos can’t be added to albums. Turn on Show in my gallery first.'
        )
        fireEvent.click(add)
        expect(
          screen.queryByRole('dialog', { name: /Add \d+ photos? to an album/ })
        ).not.toBeInTheDocument()
        // Editing them is still fine.
        expect(
          within(bar()).getByRole('button', { name: 'Edit details' })
        ).not.toHaveAttribute('aria-disabled')
      })

      it('adds the photos in the gallery and says how many hidden ones were skipped', async () => {
        answerWith((ids) => accepted(ids))
        renderMixed()
        startSelecting()
        pick('2', '1', '3')
        expect(bar()).toHaveTextContent('2 hidden photos will be skipped')
        fireEvent.click(
          within(bar()).getByRole('button', { name: 'Add to album' })
        )
        fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Add 1 photo' }))

        expect(
          await screen.findByText(
            /Added 1 photo to “Kruger”\. 2 hidden photos skipped: turn on Show in my gallery to add them to albums\./
          )
        ).toBeVisible()
        const posts = fetchMock.mock.calls.filter(
          ([, init]) => init?.method === 'POST'
        )
        expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
          media_ids: ['1']
        })
      })

      it('starts a new album from the photos in the gallery only', async () => {
        answerWith((ids) => accepted(ids))
        renderMixed()
        startSelecting()
        pick('4', '2')
        fireEvent.click(
          within(bar()).getByRole('button', { name: 'Add to album' })
        )
        fireEvent.click(
          await screen.findByRole('button', {
            name: 'New album with this photo'
          })
        )

        expect(formDialog.current?.initialMediaIds).toEqual(['4'])
        expect(formDialog.current?.initialItems?.map((i) => i.mediaId)).toEqual(
          ['4']
        )
        await act(async () => formDialog.current?.onSaved('new-album'))
        expect(
          await screen.findByText(
            'Album created. 1 hidden photo skipped: turn on Show in my gallery to add it to albums.'
          )
        ).toBeVisible()
      })

      it('forgets a pick that left the list after a save', async () => {
        renderMixed('in_gallery')
        startSelecting()
        pick('1', '4')
        fireEvent.click(
          within(bar()).getByRole('button', { name: 'Edit details' })
        )

        await act(async () =>
          editDialog.current?.onSaved([
            buildGalleryItem('1', { inGallery: false })
          ])
        )

        expect(bar()).toHaveTextContent('1 selected')
        expect(
          screen.queryByRole('button', { name: 'Select 1' })
        ).not.toBeInTheDocument()
      })
    })

    it('caps Edit details at 40 photos', () => {
      const many = (count: number) =>
        Array.from({ length: count }, (_, index) =>
          buildGalleryItem(String(index + 1))
        )
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{ items: many(41), nextMaxId: null }}
        />
      )
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select all loaded' }))

      const bar = screen.getByRole('region', { name: 'Selection' })
      const edit = within(bar).getByRole('button', { name: 'Edit details' })
      expect(edit).toHaveAttribute('aria-disabled', 'true')
      expect(bar).toHaveTextContent('Edit up to 40 at a time')
      fireEvent.click(edit)
      expect(editDialog.current).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Select 41' }))
      expect(edit).not.toHaveAttribute('aria-disabled')
      expect(bar).not.toHaveTextContent('Edit up to 40 at a time')
      fireEvent.click(edit)
      expect(editDialog.current?.items).toHaveLength(40)
    })

    it('dismisses the result', async () => {
      answerWith((ids) => accepted(ids))
      renderAllMedia()
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
