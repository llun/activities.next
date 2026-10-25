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

import {
  countGalleryMedia,
  deleteUnpostedMedia,
  getGalleryAlbumMembership,
  getGalleryMedia,
  getGalleryMediaFacets,
  getGalleryMediaIds
} from '@/lib/client'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryMediaFilterBarProps } from '@/lib/components/gallery/filters/GalleryMediaFilterBar'
import type { GalleryMediaFilterEmptyProps } from '@/lib/components/gallery/filters/GalleryMediaFilterEmpty'
import { EMPTY_GALLERY_FILTERS } from '@/lib/components/gallery/filters/galleryMediaFilterState'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import type { GalleryMediaPage } from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'
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
    deleteUnpostedMedia: vi.fn(),
    getGalleryAlbums: albums.getGalleryAlbums,
    addGalleryAlbumItems: albums.addGalleryAlbumItems,
    getGalleryAlbumMembership: vi.fn(),
    GalleryAlbumAddError: albums.GalleryAlbumAddError,
    getGalleryMediaFacets: vi.fn(),
    countGalleryMedia: vi.fn(),
    getGalleryMediaIds: vi.fn()
  }
})

const filterBarProps = vi.hoisted(() => ({
  current: null as null | GalleryMediaFilterBarProps
}))

vi.mock('@/lib/components/gallery/filters/GalleryMediaFilterBar', () => ({
  GalleryMediaFilterBar: (props: GalleryMediaFilterBarProps) => {
    filterBarProps.current = props
    return (
      <div
        data-testid="filter-bar"
        data-total={props.total !== null ? String(props.total) : ''}
      >
        {props.leading}
        <button
          type="button"
          onClick={() =>
            props.onChange({
              species: 'sci:panthera leo',
              place: null,
              date: null,
              activity: null,
              notInAlbum: false,
              sort: 'taken_desc',
              order: ['species']
            })
          }
        >
          Filter lions
        </button>
        <button
          type="button"
          onClick={() =>
            props.onChange({
              species: 'sci:fratercula arctica',
              place: null,
              date: null,
              activity: null,
              notInAlbum: false,
              sort: 'uploaded',
              order: ['species']
            })
          }
        >
          Filter puffins and sort uploaded
        </button>
      </div>
    )
  }
}))

const filterEmptyProps = vi.hoisted(() => ({
  current: null as null | GalleryMediaFilterEmptyProps
}))

vi.mock('@/lib/components/gallery/filters/GalleryMediaFilterEmpty', () => ({
  GalleryMediaFilterEmpty: (props: GalleryMediaFilterEmptyProps) => {
    filterEmptyProps.current = props
    return (
      <div data-testid="filter-empty">
        <button
          type="button"
          onClick={() =>
            props.onChange({
              ...EMPTY_GALLERY_FILTERS,
              sort: props.filters.sort
            })
          }
        >
          Clear filters
        </button>
      </div>
    )
  }
}))

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const addDialog = vi.hoisted(() => ({
  current: null as null | {
    files: File[]
    onClose: () => void
    onAdded: (mediaIds: string[]) => void
  }
}))
vi.mock('@/lib/components/gallery/AddToGalleryDialog', () => ({
  AddToGalleryDialog: (props: NonNullable<typeof addDialog.current>) => {
    addDialog.current = props
    return <div role="dialog" aria-label="Add to gallery" />
  }
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
    onPost?: (mediaIds: string[]) => void
    onDeleted?: (mediaIds: string[]) => void
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
    groups,
    selection,
    onAlbumsChanged
  }: {
    items: { mediaId: string }[]
    groups?: {
      key: string
      header: React.ReactNode
      items: { mediaId: string }[]
    }[]
    selection?: {
      selected: ReadonlySet<string>
      onToggle: (
        item: { mediaId: string },
        modifiers?: { shiftKey: boolean }
      ) => void
      anchorId?: string | null
    }
    onAlbumsChanged?: (albumIds: string[]) => void
  }) => (
    <div data-testid="grid" data-selecting={selection ? 'yes' : 'no'}>
      {groups
        ? groups.map((group) => (
            <section key={group.key}>
              {group.header}
              <ul data-testid="grid-tiles">
                {group.items.map((item) => (
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
                    {selection ? (
                      <button
                        type="button"
                        onClick={() =>
                          selection.onToggle(item, { shiftKey: true })
                        }
                      >
                        Shift-select {item.mediaId}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        : items.map((item) => (
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
      <button type="button" onClick={() => onAlbumsChanged?.(['album-1'])}>
        Change albums
      </button>
      {selection ? (
        <button
          type="button"
          onClick={() => selection.onToggle({ mediaId: 'missing-from-seen' })}
        >
          Select missing
        </button>
      ) : null}
    </div>
  )
}))

const getGalleryMediaMock = getGalleryMedia as jest.Mock
const getGalleryMediaIdsMock = getGalleryMediaIds as jest.Mock
const deleteUnpostedMediaMock = deleteUnpostedMedia as jest.Mock
const getGalleryAlbumMembershipMock = getGalleryAlbumMembership as jest.Mock
const getGalleryMediaFacetsMock = getGalleryMediaFacets as jest.Mock
const countGalleryMediaMock = countGalleryMedia as jest.Mock

// The text of the tiles alone, without the day headers the grid now renders.
const gridTileText = () =>
  screen
    .getAllByTestId('grid-tiles')
    .map((list) => list.textContent ?? '')
    .join('')

describe('GalleryAllMediaView', () => {
  beforeEach(() => {
    getGalleryMediaMock.mockReset()
    getGalleryAlbumMembershipMock.mockReset()
    getGalleryAlbumMembershipMock.mockResolvedValue({ albums: [] })
    getGalleryMediaFacetsMock.mockReset()
    getGalleryMediaFacetsMock.mockResolvedValue({
      total: 0,
      species: [],
      places: [],
      noPlaceCount: 0,
      months: [],
      activities: [],
      notFromActivityCount: 0
    })
    countGalleryMediaMock.mockReset()
    countGalleryMediaMock.mockResolvedValue(0)
    getGalleryMediaIdsMock.mockReset()
    fetchMock.resetMocks()
    formDialog.current = null
    editDialog.current = null
    addDialog.current = null
    filterBarProps.current = null
    filterEmptyProps.current = null
    router.push.mockReset()
    deleteUnpostedMediaMock.mockReset()
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
    expect(gridTileText()).not.toContain('5')
    expect(getGalleryMediaMock).toHaveBeenCalledWith('actor-1', {
      limit: 24,
      includeTotal: true,
      includeDays: true,
      maxId: undefined,
      subject: undefined,
      category: 'mammal',
      show: 'all',
      sort: 'taken_desc'
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

  it('scrolls back to the filter bar when a filter changes', async () => {
    getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    // The bar has scrolled above the viewport.
    const rectSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: -100 } as DOMRect)
    try {
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: 'Filter lions' }))
      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: 'start' })
      )
      expect(scrollIntoView.mock.instances[0]).toBe(
        screen.getByTestId('filter-bar').parentElement
      )
    } finally {
      rectSpy.mockRestore()
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('refetches the facets when the filter bar asks to retry', async () => {
    render(
      <GalleryAllMediaView
        actorId="actor-1"
        initialCategory={null}
        initialShow="all"
        initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
      />
    )
    await waitFor(() =>
      expect(getGalleryMediaFacetsMock).toHaveBeenCalledTimes(1)
    )
    act(() => filterBarProps.current!.onRetryFacets!())
    await waitFor(() =>
      expect(getGalleryMediaFacetsMock).toHaveBeenCalledTimes(2)
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
      screen.getByText("Every photo and video you've posted or added")
    ).toBeInTheDocument()
  })

  const openShowMenu = async () => {
    const nav = screen.getByRole('group', { name: 'Show' })
    fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
    return screen.findByRole('menu')
  }

  describe('show filter', () => {
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

    it('offers the five lists with a hint each', async () => {
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
        'EverythingPhotos and videos you’ve posted or added',
        'In galleryShown in your gallery',
        'Hidden from galleryShow in my gallery is switched off',
        'Not postedAdded in Gallery, only you can see them',
        'Not in any albumPhotos you haven’t filed yet'
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
      },
      {
        description: 'not posted',
        label: /^Not posted/,
        show: 'not_posted'
      },
      {
        description: 'not in any album',
        label: /^Not in any album/,
        show: 'not_in_album'
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
          limit: 24,
          includeTotal: true,
          includeDays: true,
          maxId: undefined,
          subject: undefined,
          category: 'bird',
          show,
          sort: 'taken_desc'
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

      await openShowMenu()
      fireEvent.click(
        await screen.findByRole('menuitem', { name: /^Not posted/ })
      )
      expect(
        await screen.findByText('No photos waiting to be posted')
      ).toBeInTheDocument()

      await openShowMenu()
      fireEvent.click(
        await screen.findByRole('menuitem', { name: /^Not in any album/ })
      )
      expect(
        await screen.findByText('Every photo is in an album')
      ).toBeInTheDocument()
    })
  })

  describe('add to gallery', () => {
    const renderView = (
      items = [buildGalleryItem('5')],
      isMediaUploadEnabled?: boolean
    ) =>
      render(
        <InstanceLimitsProvider maxMediaAttachments={4}>
          <GalleryAllMediaView
            actorId="actor-1"
            initialCategory={null}
            initialShow="all"
            initialPage={{ items, nextMaxId: null }}
            isMediaUploadEnabled={isMediaUploadEnabled}
          />
        </InstanceLimitsProvider>
      )

    const photo = (name: string, type = 'image/jpeg') =>
      new File(['x'], name, { type })

    const pick = (...files: File[]) =>
      fireEvent.change(
        screen.getByLabelText('Choose photos and videos to add'),
        { target: { files } }
      )

    it('offers a primary Add button before Select that opens the picker', () => {
      renderView()
      const buttons = screen
        .getAllByRole('button')
        .map((button) => button.textContent)
      expect(buttons.indexOf('Add')).toBeGreaterThan(-1)
      expect(buttons.indexOf('Add')).toBeLessThan(buttons.indexOf('Select'))

      const input = screen.getByLabelText(
        'Choose photos and videos to add'
      ) as HTMLInputElement
      expect(input).toHaveAttribute('multiple')
      expect(input.accept).toContain('image/jpeg')
      expect(input.accept).toContain('video/mp4')
      expect(input.accept).not.toContain('audio')
      const click = vi.spyOn(input, 'click')
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
      expect(click).toHaveBeenCalled()
    })

    it('opens Add to gallery with the picked files', () => {
      renderView()
      pick(photo('a.jpg'), photo('b.mp4', 'video/mp4'))

      expect(
        screen.getByRole('dialog', { name: 'Add to gallery' })
      ).toBeVisible()
      expect(addDialog.current?.files.map((file) => file.name)).toEqual([
        'a.jpg',
        'b.mp4'
      ])
    })

    it('leaves out what is not a photo or a video, and says so', () => {
      renderView()
      pick(photo('a.jpg'), photo('notes.txt', 'text/plain'))

      expect(addDialog.current?.files.map((file) => file.name)).toEqual([
        'a.jpg'
      ])
      expect(
        screen.getByText(/1 file was skipped: only photos and videos/)
      ).toBeVisible()
    })

    it('does not open the dialog when nothing can be added', () => {
      renderView()
      pick(photo('notes.txt', 'text/plain'))

      expect(addDialog.current).toBeNull()
      expect(
        screen.getByText(/Only photos and videos can be added/)
      ).toBeVisible()
    })

    it('takes at most 40 files at a time', () => {
      renderView()
      pick(...Array.from({ length: 43 }, (_, i) => photo(`p${i}.jpg`)))

      expect(addDialog.current?.files).toHaveLength(40)
      expect(screen.getByText(/Only the first 40 were taken/)).toBeVisible()
    })

    it('shows the drop overlay while files are dragged over the page', () => {
      renderView()
      expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument()

      const dataTransfer = { types: ['Files'], files: [] }
      fireEvent.dragEnter(window, { dataTransfer })
      const overlay = screen.getByTestId('drop-overlay')
      expect(overlay).toHaveTextContent(
        'Drop photos and videos to add them to your gallery'
      )
      expect(overlay).toHaveTextContent(
        'Only you can see them until you post them'
      )

      fireEvent.dragLeave(window, { dataTransfer })
      expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument()
    })

    it('ignores drags that carry no files', () => {
      renderView()
      fireEvent.dragEnter(window, { dataTransfer: { types: ['text/plain'] } })
      expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument()
    })

    it('adds the dropped files', () => {
      renderView()
      const file = photo('dropped.jpg')
      const dataTransfer = { types: ['Files'], files: [file] }
      fireEvent.dragEnter(window, { dataTransfer })
      fireEvent.drop(window, { dataTransfer })

      expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument()
      expect(addDialog.current?.files).toEqual([file])
    })

    it('says what was added, starts over at the new photos and offers to post them', async () => {
      getGalleryMediaMock.mockResolvedValue({
        items: [
          buildGalleryItem('9', { statusId: null, posted: false }),
          buildGalleryItem('8', { statusId: null, posted: false })
        ],
        nextMaxId: null
      })
      renderView()
      pick(photo('a.jpg'), photo('b.jpg'))

      await act(async () => addDialog.current?.onAdded(['9', '8']))
      act(() => addDialog.current?.onClose())

      expect(
        await screen.findByTestId('gallery-added-toast')
      ).toHaveTextContent('2 added to your gallery.')
      await waitFor(() =>
        expect(screen.getByTestId('grid')).toHaveTextContent('98')
      )
      expect(getGalleryMediaMock).toHaveBeenCalledWith(
        'actor-1',
        expect.objectContaining({ show: 'all', category: undefined })
      )

      fireEvent.click(screen.getByRole('button', { name: 'Post them' }))
      expect(router.push).toHaveBeenCalledWith('/?media=9,8')
      expect(
        screen.queryByTestId('gallery-added-toast')
      ).not.toBeInTheDocument()
    })

    it('turns Post them off above the instance limit, and says it', async () => {
      getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
      renderView()
      pick(photo('a.jpg'))
      const mediaIds = ['1', '2', '3', '4', '5']

      await act(async () => addDialog.current?.onAdded(mediaIds))
      act(() => addDialog.current?.onClose())

      expect(
        await screen.findByTestId('gallery-added-toast')
      ).toHaveTextContent('5 added to your gallery.')
      const post = screen.getByRole('button', { name: 'Post them' })
      expect(post).toBeDisabled()
      expect(post).toHaveAccessibleDescription('Up to 4 per post')
      expect(screen.getByTestId('added-announcement')).toHaveTextContent(
        '5 added to your gallery. Up to 4 per post: select some to post.'
      )
      fireEvent.click(post)
      expect(router.push).not.toHaveBeenCalled()
    })

    it('offers neither Add nor the drop when there is no media storage', () => {
      renderView([buildGalleryItem('5')], false)

      expect(
        screen.queryByRole('button', { name: 'Add' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByLabelText('Choose photos and videos to add')
      ).not.toBeInTheDocument()
      const dataTransfer = { types: ['Files'], files: [photo('a.jpg')] }
      fireEvent.dragEnter(window, { dataTransfer })
      fireEvent.drop(window, { dataTransfer })
      expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument()
      expect(addDialog.current).toBeNull()
    })

    it('ignores a second drop while Add to gallery is open', () => {
      renderView()
      const first = photo('first.jpg')
      const dataTransfer = (file: File) => ({ types: ['Files'], files: [file] })
      fireEvent.dragEnter(window, { dataTransfer: dataTransfer(first) })
      fireEvent.drop(window, { dataTransfer: dataTransfer(first) })
      expect(addDialog.current?.files).toEqual([first])

      const second = photo('second.jpg')
      fireEvent.dragEnter(window, { dataTransfer: dataTransfer(second) })
      expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument()
      // Still taken, or the browser would open the file in this tab.
      const dragOverNotPrevented = fireEvent.dragOver(window, {
        dataTransfer: dataTransfer(second)
      })
      const dropNotPrevented = fireEvent.drop(window, {
        dataTransfer: dataTransfer(second)
      })

      expect(dragOverNotPrevented).toBeFalse()
      expect(dropNotPrevented).toBeFalse()
      expect(addDialog.current?.files).toEqual([first])
    })

    it('ignores a drop over a dialog the grid opened, and still takes it', () => {
      renderView()
      const viewer = document.createElement('div')
      viewer.setAttribute('role', 'dialog')
      document.body.appendChild(viewer)
      try {
        const dataTransfer = { types: ['Files'], files: [photo('a.jpg')] }
        fireEvent.dragEnter(window, { dataTransfer })
        expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument()
        const notPrevented = fireEvent.drop(window, { dataTransfer })

        expect(notPrevented).toBeFalse()
        expect(addDialog.current).toBeNull()
      } finally {
        viewer.remove()
      }
    })

    it('shows Everything again when it was added from Hidden from gallery', async () => {
      getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory="bird"
          initialShow="hidden"
          initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
        />
      )
      pick(photo('a.jpg'))
      await act(async () => addDialog.current?.onAdded(['9']))

      expect(screen.getByRole('group', { name: 'Show' })).toHaveTextContent(
        'Show Everything'
      )
      expect(getGalleryMediaMock).toHaveBeenCalledWith(
        'actor-1',
        expect.objectContaining({ show: 'all', category: undefined })
      )
    })

    it('takes the toast away when Select mode starts, since its bar needs the bottom of the page', async () => {
      getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
      renderView()
      pick(photo('a.jpg'))
      await act(async () => addDialog.current?.onAdded(['9']))
      expect(
        await screen.findByTestId('gallery-added-toast')
      ).toHaveTextContent('1 added to your gallery.')

      fireEvent.click(screen.getByRole('button', { name: 'Select' }))

      expect(
        screen.queryByTestId('gallery-added-toast')
      ).not.toBeInTheDocument()
    })

    it('dismisses the toast', async () => {
      getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
      renderView()
      pick(photo('a.jpg'))
      await act(async () => addDialog.current?.onAdded(['9']))
      expect(
        await screen.findByTestId('gallery-added-toast')
      ).toHaveTextContent('1 added to your gallery.')

      fireEvent.click(
        within(screen.getByTestId('gallery-added-toast')).getByRole('button', {
          name: 'Dismiss'
        })
      )
      expect(
        screen.queryByTestId('gallery-added-toast')
      ).not.toBeInTheDocument()
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

    it('keeps the selection across Category and Show changes, and Add sends every picked id', async () => {
      answerWith((ids) => accepted(ids))
      getGalleryMediaMock
        .mockResolvedValueOnce({
          items: [buildGalleryItem('8')],
          nextMaxId: null
        })
        .mockResolvedValueOnce({
          items: [buildGalleryItem('9')],
          nextMaxId: null
        })
      renderAllMedia()
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('1 selected')

      // Switch Category
      const nav = screen.getByRole('navigation', { name: 'Category' })
      fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Mammals' }))

      await screen.findByRole('button', { name: 'Select 8' })
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('1 selected')

      // Pick photo 8 from Mammals
      fireEvent.click(screen.getByRole('button', { name: 'Select 8' }))
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('2 selected')

      // Switch Show
      await openShowMenu()
      fireEvent.click(
        await screen.findByRole('menuitem', { name: /^In gallery/ })
      )

      await screen.findByRole('button', { name: 'Select 9' })
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('2 selected')

      // Add to album sends every picked id (1 and 8), neither of which is in current list (which has 9)
      fireEvent.click(
        within(screen.getByRole('region', { name: 'Selection' })).getByRole(
          'button',
          { name: 'Add to album' }
        )
      )
      fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add 2 photos' }))

      await screen.findByText(/Added 2 photos to “Kruger”/)
      const posts = fetchMock.mock.calls.filter(
        ([, init]) => init?.method === 'POST'
      )
      expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
        media_ids: ['1', '8']
      })
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
      expect(editDialog.current?.items.map((i) => i.mediaId)).toEqual([
        '3',
        '1'
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

      it('sends hidden photos to Add to album with no hidden note', async () => {
        answerWith((ids) => accepted(ids))
        renderMixed()
        startSelecting()
        pick('2', '1', '3')
        expect(bar()).not.toHaveTextContent('hidden')
        fireEvent.click(
          within(bar()).getByRole('button', { name: 'Add to album' })
        )
        fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Add 3 photos' }))

        expect(
          await screen.findByText('Added 3 photos to “Kruger”.')
        ).toBeVisible()
        const posts = fetchMock.mock.calls.filter(
          ([, init]) => init?.method === 'POST'
        )
        expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
          media_ids: ['2', '1', '3']
        })
      })

      it('starts a new album including hidden photos with no hidden note', async () => {
        answerWith((ids) => accepted(ids))
        renderMixed()
        startSelecting()
        pick('4', '2')
        fireEvent.click(
          within(bar()).getByRole('button', { name: 'Add to album' })
        )
        fireEvent.click(
          await screen.findByRole('button', {
            name: 'New album with these photos'
          })
        )

        expect(formDialog.current?.initialMediaIds).toEqual(['4', '2'])
        expect(formDialog.current?.initialItems?.map((i) => i.mediaId)).toEqual(
          ['4', '2']
        )
        await act(async () => formDialog.current?.onSaved('new-album'))
        expect(await screen.findByText('Album created.')).toBeVisible()
      })

      it('removes the pick when a photo is deleted', async () => {
        // The delete refreshes the deleted photo's day stats.
        getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
        renderMixed()
        startSelecting()
        pick('1', '4')
        expect(bar()).toHaveTextContent('2 selected')

        fireEvent.click(
          within(bar()).getByRole('button', { name: 'Edit details' })
        )
        await act(async () => editDialog.current?.onDeleted?.(['1']))

        expect(bar()).toHaveTextContent('1 selected')
      })

      it('reloads the grid when an add finishes on not_in_album show', async () => {
        answerWith((ids) => accepted(ids))
        getGalleryMediaMock.mockResolvedValue({
          items: [buildGalleryItem('5')],
          nextMaxId: null
        })
        render(
          <GalleryAllMediaView
            actorId="actor-1"
            initialCategory={null}
            initialShow="not_in_album"
            initialPage={{ items: mixed(), nextMaxId: null }}
          />
        )
        startSelecting()
        pick('1')

        fireEvent.click(
          within(bar()).getByRole('button', { name: 'Add to album' })
        )
        fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Add 1 photo' }))

        await waitFor(() =>
          expect(getGalleryMediaMock).toHaveBeenCalledWith(
            'actor-1',
            expect.objectContaining({ show: 'not_in_album' })
          )
        )
      })

      it('reloads the grid when albums change in the viewer on not_in_album show', async () => {
        getGalleryMediaMock.mockResolvedValue({
          items: [buildGalleryItem('5')],
          nextMaxId: null
        })
        render(
          <GalleryAllMediaView
            actorId="actor-1"
            initialCategory={null}
            initialShow="not_in_album"
            initialPage={{ items: mixed(), nextMaxId: null }}
          />
        )

        expect(getGalleryMediaMock).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Change albums' }))

        await waitFor(() =>
          expect(getGalleryMediaMock).toHaveBeenCalledWith(
            'actor-1',
            expect.objectContaining({ show: 'not_in_album' })
          )
        )
      })

      it('does not reload the grid when albums change in the viewer on other show modes', () => {
        render(
          <GalleryAllMediaView
            actorId="actor-1"
            initialCategory={null}
            initialShow="all"
            initialPage={{ items: mixed(), nextMaxId: null }}
          />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Change albums' }))
        expect(getGalleryMediaMock).not.toHaveBeenCalled()
      })
    })

    describe('post and delete', () => {
      const mixed = () => [
        buildGalleryItem('1', { statusId: null, posted: false }),
        buildGalleryItem('2', { statusId: null, posted: false }),
        buildGalleryItem('3', { posted: true }),
        buildGalleryItem('4', { statusId: null, posted: false })
      ]
      const renderMixed = (maxMediaAttachments = 4) =>
        render(
          <InstanceLimitsProvider maxMediaAttachments={maxMediaAttachments}>
            <GalleryAllMediaView
              actorId="actor-1"
              initialCategory={null}
              initialShow="all"
              initialPage={{ items: mixed(), nextMaxId: null }}
            />
          </InstanceLimitsProvider>
        )
      const bar = () => screen.getByRole('region', { name: 'Selection' })
      const pickPhotos = (...ids: string[]) => {
        startSelecting()
        for (const id of ids) {
          fireEvent.click(screen.getByRole('button', { name: `Select ${id}` }))
        }
      }

      it('turns Post and Delete off until something is picked', () => {
        renderMixed()
        pickPhotos()
        for (const name of ['Post', 'Delete']) {
          expect(within(bar()).getByRole('button', { name })).toHaveAttribute(
            'aria-disabled',
            'true'
          )
        }
        expect(bar()).not.toHaveTextContent('Only photos you haven’t posted')
      })

      it('posts the picked photos in the order they were picked', () => {
        renderMixed()
        pickPhotos('4', '1')

        fireEvent.click(within(bar()).getByRole('button', { name: 'Post' }))

        expect(router.push).toHaveBeenCalledWith('/?media=4,1')
      })

      it('turns Post and Delete off when a posted photo is picked, and says why', () => {
        renderMixed()
        pickPhotos('1', '3')

        expect(bar()).toHaveTextContent('Only photos you haven’t posted')
        for (const name of ['Post', 'Delete']) {
          const button = within(bar()).getByRole('button', { name })
          expect(button).toHaveAttribute('aria-disabled', 'true')
          fireEvent.click(button)
        }
        expect(router.push).not.toHaveBeenCalled()
        expect(
          screen.queryByRole('dialog', { name: /^Delete/ })
        ).not.toBeInTheDocument()
      })

      it('keeps item actions off when a selected id has no entity', async () => {
        renderMixed()
        pickPhotos('1')
        expect(
          within(bar()).getByRole('button', { name: 'Post' })
        ).not.toHaveAttribute('aria-disabled')

        fireEvent.click(screen.getByRole('button', { name: 'Select missing' }))

        expect(bar()).toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
        for (const name of ['Post', 'Delete']) {
          const action = within(bar()).getByRole('button', { name })
          expect(action).toHaveAttribute('aria-disabled', 'true')
          expect(
            document.getElementById(action.getAttribute('aria-describedby')!)
          ).toHaveTextContent("Some selected photos couldn't be loaded")
          fireEvent.click(action)
        }
        expect(router.push).not.toHaveBeenCalled()
        expect(
          screen.queryByRole('dialog', { name: /^Delete/ })
        ).not.toBeInTheDocument()
        expect(
          within(bar()).getByRole('button', { name: 'Add to album' })
        ).not.toHaveAttribute('aria-disabled')
        expect(
          within(bar()).getByRole('button', { name: 'Retry loading' })
        ).toBeInTheDocument()
      })

      it('turns Post off above the instance limit, and says it', () => {
        renderMixed(2)
        pickPhotos('1', '2', '4')

        const post = within(bar()).getByRole('button', { name: 'Post' })
        expect(post).toHaveAttribute('aria-disabled', 'true')
        expect(bar()).toHaveTextContent('Up to 2 per post')
        fireEvent.click(post)
        expect(router.push).not.toHaveBeenCalled()
        // Delete has no such limit.
        expect(
          within(bar()).getByRole('button', { name: 'Delete' })
        ).not.toHaveAttribute('aria-disabled')
      })

      it('asks before deleting, then removes the photos', async () => {
        deleteUnpostedMediaMock.mockResolvedValue(undefined)
        // The delete refreshes the deleted photos' day stats.
        getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
        renderMixed()
        pickPhotos('1', '2')

        fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
        const dialog = await screen.findByRole('dialog', {
          name: 'Delete 2 photos?'
        })
        expect(dialog).toHaveTextContent('This can’t be undone.')
        expect(deleteUnpostedMediaMock).not.toHaveBeenCalled()

        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Delete 2 photos' })
        )

        await waitFor(() =>
          expect(deleteUnpostedMediaMock.mock.calls.map((c) => c[0])).toEqual([
            '1',
            '2'
          ])
        )
        expect(await screen.findByText('Deleted 2 photos.')).toBeVisible()
        expect(gridTileText()).not.toMatch(/[12]/)
        expect(screen.getByTestId('grid')).toHaveTextContent('3')
        // Select mode is over, with focus back on Select.
        expect(
          screen.queryByRole('region', { name: 'Selection' })
        ).not.toBeInTheDocument()
      })

      it('keeps the photos when the delete is cancelled', async () => {
        renderMixed()
        pickPhotos('1')
        fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
        const dialog = await screen.findByRole('dialog', {
          name: 'Delete 1 photo?'
        })

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

        await waitFor(() =>
          expect(
            screen.queryByRole('dialog', { name: 'Delete 1 photo?' })
          ).not.toBeInTheDocument()
        )
        expect(deleteUnpostedMediaMock).not.toHaveBeenCalled()
        expect(bar()).toHaveTextContent('1 selected')
      })

      it('says why a delete failed and keeps the dialog open', async () => {
        deleteUnpostedMediaMock.mockRejectedValue(new Error('Server said no'))
        renderMixed()
        pickPhotos('1')
        fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
        const dialog = await screen.findByRole('dialog', {
          name: 'Delete 1 photo?'
        })

        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Delete 1 photo' })
        )

        expect(await within(dialog).findByText('Server said no')).toBeVisible()
        expect(screen.getByTestId('grid')).toHaveTextContent('1')
      })

      it('hands Post and Delete from Edit details to the page', async () => {
        // The delete refreshes the deleted photo's day stats.
        getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
        renderMixed()
        pickPhotos('1')
        fireEvent.click(
          within(bar()).getByRole('button', { name: 'Edit details' })
        )
        await screen.findByRole('dialog', { name: 'Edit details' })

        act(() => editDialog.current?.onPost?.(['1']))
        expect(router.push).toHaveBeenCalledWith('/?media=1')

        await act(async () => editDialog.current?.onDeleted?.(['1']))
        expect(await screen.findByText('Deleted 1 photo.')).toBeVisible()
        expect(gridTileText()).not.toContain('1')
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

  describe('day headers and Select day', () => {
    const dayPhotos = () => [
      buildGalleryItem('1', { takenAt: '2025-10-04T09:30:00.000Z' }),
      buildGalleryItem('2', { takenAt: '2025-10-04T10:30:00.000Z' }),
      buildGalleryItem('3', { takenAt: '2025-10-03T09:30:00.000Z' })
    ]
    const dayStats = (count: number, placeName: string | null = null) => ({
      count,
      placeName,
      activity: null
    })
    const renderGrouped = (
      days: Record<string, ReturnType<typeof dayStats>> = {
        '2025-10-04': dayStats(2, 'Box Hill, Surrey'),
        '2025-10-03': dayStats(1)
      }
    ) =>
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{ items: dayPhotos(), nextMaxId: null, days }}
        />
      )
    const bar = () => screen.getByRole('region', { name: 'Selection' })
    const startSelecting = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    const uploadPhoto = (id: string) =>
      buildGalleryItem(id, {
        takenAt: null,
        uploadedAt: '2025-10-04T10:00:00.000Z',
        attachment: {
          ...buildGalleryItem(id).attachment,
          createdAt: new Date('2025-10-04T10:00:00.000Z').getTime()
        }
      })

    it('groups the photos under day headers carrying the server counts', () => {
      renderGrouped({
        // A half-loaded day shows its full count, not the loaded one.
        '2025-10-04': dayStats(14, 'Box Hill, Surrey'),
        '2025-10-03': dayStats(1)
      })

      expect(
        screen.getByRole('heading', { name: /Sat 4 Oct 2025/ })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: /Fri 3 Oct 2025/ })
      ).toBeInTheDocument()
      expect(
        screen.getByText('Box Hill, Surrey · 14 photos')
      ).toBeInTheDocument()
      expect(screen.getByText('1 photo')).toBeInTheDocument()
      // Out of Select mode the headers carry no Select day button.
      expect(
        screen.queryByRole('button', { name: /Select day/ })
      ).not.toBeInTheDocument()
    })

    it('does not re-note old items when sort and species change while selecting', async () => {
      const oldPhoto = buildGalleryItem('1', {
        takenAt: '2025-10-04T09:30:00.000Z',
        uploadedAt: '2025-10-04T10:00:00.000Z',
        attachment: {
          ...buildGalleryItem('1').attachment,
          createdAt: new Date('2025-10-04T10:00:00.000Z').getTime()
        }
      })
      getGalleryMediaMock.mockResolvedValueOnce({
        items: [uploadPhoto('2')],
        days: { 'uploaded:2025-10-04': dayStats(1) },
        nextMaxId: null,
        nextCursor: null
      })
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: [oldPhoto],
            days: { '2025-10-04': dayStats(1) },
            nextMaxId: null
          }}
        />
      )
      startSelecting()
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Filter puffins and sort uploaded'
        })
      )

      const dayButton = await screen.findByRole('button', {
        name: 'Select day, Uploaded Sat 4 Oct 2025'
      })
      expect(dayButton).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'Deselect day, Uploaded Sat 4 Oct 2025'
        })
      ).not.toBeInTheDocument()
    })

    it('counts a hand pick in the day header after Select mode starts', () => {
      renderGrouped()
      startSelecting()

      // Select mode is a resetKey change that clears the learned days
      // without reloading the grid: the loaded tiles are re-noted, so the
      // header counts the pick.
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))

      expect(
        screen.getByText('Box Hill, Surrey · 2 photos · 1 picked')
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Select 1 more, Sat 4 Oct 2025' })
      ).toBeInTheDocument()
    })

    it('selects a whole day from its header, with a toast and Undo', async () => {
      getGalleryMediaIdsMock.mockResolvedValue(['1', '2'])
      renderGrouped()
      startSelecting()

      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )

      await waitFor(() => expect(bar()).toHaveTextContent('2 selected'))
      expect(getGalleryMediaIdsMock).toHaveBeenCalledWith(
        'actor-1',
        expect.objectContaining({
          dayKey: '2025-10-04',
          limit: 2000,
          offset: 0,
          show: 'all',
          sort: 'taken_desc'
        })
      )
      expect(screen.getByTestId('album-toast')).toHaveTextContent(
        'Selected 2 photos from Sat 4 Oct 2025'
      )
      expect(screen.getByTestId('day-undo-toast-container')).toHaveClass(
        'pointer-events-none'
      )
      const stack = screen.getByTestId('day-selection-stack')
      expect(stack).toHaveClass('sticky')
      expect(stack).toContainElement(bar())
      expect(
        screen.getByTestId('day-selection-feedback').nextElementSibling
      ).toBe(bar())
      expect(screen.getByTestId('added-announcement')).toHaveTextContent(
        'Selected 2 photos'
      )

      fireEvent.click(
        within(screen.getByTestId('album-toast')).getByRole('button', {
          name: 'Undo'
        })
      )
      expect(bar()).toHaveTextContent('0 selected')
    })

    it('keeps Select day feedback in one sticky stack directly above the selection bar', async () => {
      getGalleryMediaIdsMock
        .mockResolvedValueOnce(['1', '2'])
        .mockRejectedValueOnce(new Error('Day fetch failed'))
      renderGrouped()
      startSelecting()

      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )
      await screen.findByTestId('album-toast')

      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Fri 3 Oct 2025' })
      )
      await screen.findByRole('alert')

      const stack = screen.getByTestId('day-selection-stack')
      const feedback = screen.getByTestId('day-selection-feedback')
      expect(stack).toHaveClass('sticky')
      expect(feedback).toContainElement(screen.getByTestId('album-toast'))
      expect(feedback).toContainElement(screen.getByRole('alert'))
      expect(stack).toContainElement(bar())
      expect(feedback.nextElementSibling).toBe(bar())
    })

    it('hydrates unloaded Select day photos for Edit details and new albums', async () => {
      const dayItems = [
        buildGalleryItem('1', { takenAt: '2025-10-04T09:30:00.000Z' }),
        buildGalleryItem('2', { takenAt: '2025-10-04T10:30:00.000Z' })
      ]
      getGalleryMediaIdsMock.mockResolvedValueOnce(['1', '2', '4', '5'])
      getGalleryMediaMock
        .mockResolvedValueOnce({
          items: [
            buildGalleryItem('4', { takenAt: '2025-10-04T11:30:00.000Z' })
          ],
          nextCursor: 'day-page-2',
          nextMaxId: null
        })
        .mockResolvedValueOnce({
          items: [
            buildGalleryItem('5', { takenAt: '2025-10-04T12:30:00.000Z' })
          ],
          nextCursor: null,
          nextMaxId: null
        })

      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: dayItems,
            nextMaxId: null,
            days: { '2025-10-04': dayStats(4) }
          }}
        />
      )
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )

      await waitFor(() => expect(bar()).toHaveTextContent('4 selected'))
      await waitFor(() => expect(getGalleryMediaMock).toHaveBeenCalledTimes(2))
      expect(getGalleryMediaMock).toHaveBeenNthCalledWith(
        1,
        'actor-1',
        expect.objectContaining({
          dayKey: '2025-10-04',
          limit: 60
        })
      )
      expect(getGalleryMediaMock).toHaveBeenNthCalledWith(
        2,
        'actor-1',
        expect.objectContaining({ cursor: 'day-page-2' })
      )

      fireEvent.click(
        within(bar()).getByRole('button', { name: 'Edit details' })
      )
      await screen.findByRole('dialog', { name: 'Edit details' })
      expect(editDialog.current?.items.map((item) => item.mediaId)).toEqual([
        '1',
        '2',
        '4',
        '5'
      ])
      await act(async () => editDialog.current?.onClose())

      fireEvent.click(
        within(bar()).getByRole('button', { name: 'Add to album' })
      )
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'New album with these photos'
        })
      )
      expect(formDialog.current?.initialMediaIds).toEqual(['1', '2', '4', '5'])
      expect(
        formDialog.current?.initialItems?.map((item) => item.mediaId)
      ).toEqual(['1', '2', '4', '5'])
    })

    const selectPartiallyHydratedDay = async () => {
      getGalleryMediaIdsMock.mockResolvedValueOnce(['1', '2', '4', '5'])
      getGalleryMediaMock.mockResolvedValueOnce({
        items: [buildGalleryItem('4', { takenAt: '2025-10-04T11:30:00.000Z' })],
        nextCursor: null,
        nextMaxId: null
      })
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: dayPhotos().slice(0, 2),
            nextMaxId: null,
            days: { '2025-10-04': dayStats(4, 'Box Hill, Surrey') }
          }}
        />
      )
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )
      await waitFor(() =>
        expect(bar()).toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
      )
    }

    const answerAlbumAdd = () => {
      const albums = [buildAlbumCard('a1', { title: 'Kruger', itemCount: 4 })]
      fetchMock.mockResponse(async (request) => {
        if (request.method === 'GET') {
          return JSON.stringify({ albums, photoCount: 5 })
        }
        const body = (await request.json()) as { media_ids: string[] }
        return {
          body: JSON.stringify({
            added: body.media_ids,
            existing: [],
            skipped: [],
            album: albums[0]
          })
        }
      })
    }

    it('adds every selected id to an album when some selected photos are still unloaded', async () => {
      answerAlbumAdd()
      await selectPartiallyHydratedDay()

      expect(bar()).toHaveTextContent('4 selected')
      expect(bar()).toHaveTextContent("Some selected photos couldn't be loaded")
      for (const name of ['Edit details', 'Post', 'Delete']) {
        expect(within(bar()).getByRole('button', { name })).toHaveAttribute(
          'aria-disabled',
          'true'
        )
      }
      expect(
        within(bar()).getByRole('button', { name: 'Add to album' })
      ).not.toHaveAttribute('aria-disabled')

      fireEvent.click(
        within(bar()).getByRole('button', { name: 'Add to album' })
      )
      fireEvent.click(await screen.findByRole('radio', { name: /^Kruger/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add 4 photos' }))
      await screen.findByText(/Added 4 photos to “Kruger”/)

      const posts = fetchMock.mock.calls.filter(
        ([, init]) => init?.method === 'POST'
      )
      expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
        media_ids: ['1', '2', '4', '5']
      })
    })

    it('passes every selected id to New album when some selected photos are unloaded', async () => {
      answerAlbumAdd()
      await selectPartiallyHydratedDay()

      fireEvent.click(
        within(bar()).getByRole('button', { name: 'Add to album' })
      )
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'New album with these photos'
        })
      )

      expect(formDialog.current?.initialMediaIds).toEqual(['1', '2', '4', '5'])
      expect(
        formDialog.current?.initialItems?.map((item) => item.mediaId)
      ).toEqual(['1', '2', '4'])
    })

    it('retries hydration for the remaining selected ids in their day', async () => {
      getGalleryMediaIdsMock.mockResolvedValueOnce(['1', '2', '4', '5'])
      getGalleryMediaMock
        .mockResolvedValueOnce({
          items: [
            buildGalleryItem('4', { takenAt: '2025-10-04T11:30:00.000Z' })
          ],
          nextCursor: null,
          nextMaxId: null
        })
        .mockResolvedValueOnce({
          items: [
            buildGalleryItem('5', { takenAt: '2025-10-04T12:30:00.000Z' })
          ],
          nextCursor: null,
          nextMaxId: null
        })
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: dayPhotos().slice(0, 2),
            nextMaxId: null,
            days: { '2025-10-04': dayStats(4, 'Box Hill, Surrey') }
          }}
        />
      )
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )
      await waitFor(() =>
        expect(bar()).toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
      )

      fireEvent.click(
        within(bar()).getByRole('button', { name: 'Retry loading' })
      )

      await waitFor(() =>
        expect(bar()).not.toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
      )
      expect(getGalleryMediaMock).toHaveBeenNthCalledWith(
        2,
        'actor-1',
        expect.objectContaining({ dayKey: '2025-10-04' })
      )
      expect(
        within(bar()).getByRole('button', { name: 'Edit details' })
      ).not.toHaveAttribute('aria-disabled')
    })

    it('hydrates a Retry loading with the sort the pick was selected under', async () => {
      getGalleryMediaIdsMock.mockResolvedValueOnce(['1', '2', '4', '5'])
      getGalleryMediaMock
        .mockResolvedValueOnce({
          items: [
            buildGalleryItem('4', { takenAt: '2025-10-04T11:30:00.000Z' })
          ],
          nextCursor: null,
          nextMaxId: null
        })
        .mockResolvedValue({
          items: [],
          nextCursor: null,
          nextMaxId: null
        })
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: dayPhotos().slice(0, 2),
            nextMaxId: null,
            days: { '2025-10-04': dayStats(4, 'Box Hill, Surrey') }
          }}
        />
      )
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )
      await waitFor(() =>
        expect(bar()).toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
      )

      // The owner switches to Recently uploaded; the pick keeps its dated
      // day key, so the retry must hydrate with the sort it was selected
      // under, never the new sort with the old key.
      fireEvent.click(
        screen.getByRole('button', { name: 'Filter puffins and sort uploaded' })
      )
      await waitFor(() =>
        expect(bar()).toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
      )

      fireEvent.click(
        within(bar()).getByRole('button', { name: 'Retry loading' })
      )

      await waitFor(() =>
        expect(getGalleryMediaMock).toHaveBeenLastCalledWith(
          'actor-1',
          expect.objectContaining({
            sort: 'taken_desc',
            dayKey: '2025-10-04'
          })
        )
      )
    })

    it('hydrates a Retry loading with the query the pick was selected under', async () => {
      getGalleryMediaIdsMock.mockResolvedValueOnce(['1', '2', '4', '5'])
      getGalleryMediaMock.mockImplementation(async (_actorId, options) => {
        // The day's hydration pages never find the missing picks and
        // always offer another page, so the read stops at the 50-page
        // bound and saves its cursor.
        if (options?.dayKey) {
          return {
            items: [],
            nextCursor: 'day-page-next',
            nextMaxId: null
          }
        }
        return {
          items: dayPhotos(),
          days: {
            '2025-10-04': dayStats(4, 'Box Hill, Surrey'),
            '2025-10-03': dayStats(1)
          },
          nextCursor: null,
          nextMaxId: null
        }
      })
      renderGrouped({
        '2025-10-04': dayStats(4, 'Box Hill, Surrey'),
        '2025-10-03': dayStats(1)
      })
      startSelecting()

      // The day is selected under a species filter (species A).
      fireEvent.click(screen.getByRole('button', { name: 'Filter lions' }))
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Select day, Sat 4 Oct 2025'
        })
      )
      await waitFor(() =>
        expect(bar()).toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
      )
      const hydrationCalls = () =>
        getGalleryMediaMock.mock.calls.filter(([, options]) => options?.dayKey)
      expect(hydrationCalls()).toHaveLength(50)
      expect(hydrationCalls()[0][1]).toEqual(
        expect.objectContaining({
          sort: 'taken_desc',
          subject: 'sci:panthera leo',
          dayKey: '2025-10-04'
        })
      )

      // The owner switches species and sort; the retry must keep paging
      // the query the picks were selected under, from the cursor the
      // first read saved.
      fireEvent.click(
        screen.getByRole('button', { name: 'Filter puffins and sort uploaded' })
      )
      await waitFor(() =>
        expect(bar()).toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
      )
      fireEvent.click(
        within(bar()).getByRole('button', { name: 'Retry loading' })
      )

      await waitFor(() => expect(hydrationCalls().length).toBeGreaterThan(50))
      expect(hydrationCalls()[50][1]).toEqual(
        expect.objectContaining({
          sort: 'taken_desc',
          subject: 'sci:panthera leo',
          dayKey: '2025-10-04',
          cursor: 'day-page-next',
          limit: 60
        })
      )
    })

    it('filters dateless hydration by upload day under a date sort', async () => {
      getGalleryMediaMock.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        nextMaxId: null
      })
      getGalleryMediaIdsMock.mockResolvedValueOnce(['missing'])
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: [uploadPhoto('1')],
            days: { 'uploaded:2025-10-04': dayStats(1) },
            nextMaxId: null
          }}
        />
      )
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Select day, Uploaded Sat 4 Oct 2025'
        })
      )

      await waitFor(() => expect(getGalleryMediaMock).toHaveBeenCalledTimes(1))
      expect(getGalleryMediaMock).toHaveBeenCalledWith(
        'actor-1',
        expect.objectContaining({
          sort: 'taken_desc',
          dayKey: 'uploaded:2025-10-04',
          limit: 60
        })
      )
    })

    it('stops requesting hydration pages after unmount', async () => {
      const nextPage = createDeferred<GalleryMediaPage>()
      getGalleryMediaMock.mockReturnValueOnce(nextPage.promise)
      getGalleryMediaIdsMock.mockResolvedValueOnce(['2', '3', '4'])
      const { unmount } = renderGrouped({ '2025-10-04': dayStats(3) })
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )
      await waitFor(() => expect(getGalleryMediaMock).toHaveBeenCalledTimes(1))
      const signal = getGalleryMediaMock.mock.calls[0][1].signal

      unmount()
      expect(signal.aborted).toBe(true)
      await act(async () => {
        nextPage.resolve({
          items: [buildGalleryItem('2')],
          nextCursor: 'day-page-2',
          nextMaxId: null
        })
        await nextPage.promise
      })

      expect(getGalleryMediaMock).toHaveBeenCalledTimes(1)
    })

    it('day-bounds uploaded hydration and stops after 50 pages', async () => {
      getGalleryMediaMock.mockResolvedValueOnce({
        items: [uploadPhoto('2')],
        days: { 'uploaded:2025-10-04': dayStats(2) },
        nextMaxId: null,
        nextCursor: null
      })
      for (let page = 1; page <= 50; page += 1) {
        getGalleryMediaMock.mockResolvedValueOnce({
          items: page === 49 ? [uploadPhoto('target')] : [],
          nextMaxId: `page-${page + 1}`,
          nextCursor: null
        })
      }
      getGalleryMediaIdsMock.mockResolvedValueOnce(['target', 'still-missing'])
      renderGrouped()
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', { name: 'Filter puffins and sort uploaded' })
      )
      await screen.findByRole('button', {
        name: 'Select day, Uploaded Sat 4 Oct 2025'
      })
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Select day, Uploaded Sat 4 Oct 2025'
        })
      )

      await waitFor(() => expect(getGalleryMediaMock).toHaveBeenCalledTimes(51))
      await waitFor(() =>
        expect(bar()).toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
      )
      expect(
        within(bar()).getByRole('button', { name: 'Edit details' })
      ).toHaveAttribute('aria-disabled', 'true')
      expect(
        within(bar()).getByRole('button', { name: 'Retry loading' })
      ).toBeInTheDocument()
      expect(getGalleryMediaMock).toHaveBeenCalledTimes(51)
      for (const [, options] of getGalleryMediaMock.mock.calls.slice(1)) {
        expect(options).not.toHaveProperty('takenFrom')
        expect(options).not.toHaveProperty('takenTo')
        expect(options).toHaveProperty('sort', 'uploaded')
        expect(options).toHaveProperty('dayKey', 'uploaded:2025-10-04')
        expect(options).toHaveProperty('limit', 60)
      }
    })

    it('disables item actions during and after short hydration while Add keeps all ids', async () => {
      const pendingPage = createDeferred<GalleryMediaPage>()
      getGalleryMediaIdsMock.mockResolvedValueOnce(['2', 'missing'])
      getGalleryMediaMock.mockReturnValueOnce(pendingPage.promise)
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: [
              buildGalleryItem('2', {
                takenAt: '2025-10-04T10:30:00.000Z',
                posted: false
              })
            ],
            nextMaxId: null,
            days: { '2025-10-04': dayStats(2) }
          }}
        />
      )
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )

      await waitFor(() => expect(getGalleryMediaMock).toHaveBeenCalledTimes(1))
      const selection = bar()
      expect(selection).toHaveTextContent('Loading 1 selected photos…')
      for (const name of ['Edit details', 'Post', 'Delete']) {
        expect(within(selection).getByRole('button', { name })).toHaveAttribute(
          'aria-disabled',
          'true'
        )
      }
      expect(
        within(selection).getByRole('button', { name: 'Add to album' })
      ).not.toHaveAttribute('aria-disabled')

      await act(async () => {
        pendingPage.resolve({
          items: [],
          nextCursor: null,
          nextMaxId: null
        })
        await pendingPage.promise
      })
      await waitFor(() =>
        expect(selection).toHaveTextContent(
          "Some selected photos couldn't be loaded"
        )
      )
      for (const name of ['Edit details', 'Post', 'Delete']) {
        expect(within(selection).getByRole('button', { name })).toHaveAttribute(
          'aria-disabled',
          'true'
        )
      }
      expect(
        within(selection).getByRole('button', { name: 'Retry loading' })
      ).toBeInTheDocument()

      fireEvent.click(
        within(selection).getByRole('button', { name: 'Add to album' })
      )
      await screen.findByRole('dialog', { name: 'Add 2 photos to an album' })
      fireEvent.click(
        screen.getByRole('button', { name: 'New album with these photos' })
      )
      await screen.findByRole('dialog', { name: 'New album' })
      expect(formDialog.current?.initialMediaIds).toEqual(['2', 'missing'])
      expect(
        formDialog.current?.initialItems?.map((item) => item.mediaId)
      ).toEqual(['2'])
      await act(async () => formDialog.current?.onOpenChange(false))

      fireEvent.click(within(selection).getByRole('button', { name: 'Delete' }))
      expect(
        screen.queryByRole('dialog', { name: /^Delete/ })
      ).not.toBeInTheDocument()

      fireEvent.click(within(selection).getByRole('button', { name: 'Post' }))
      expect(router.push).not.toHaveBeenCalled()
    })

    it('deselects the day from its header', async () => {
      getGalleryMediaIdsMock.mockResolvedValue(['1', '2'])
      renderGrouped()
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )
      await waitFor(() => expect(bar()).toHaveTextContent('2 selected'))

      fireEvent.click(
        screen.getByRole('button', { name: 'Deselect day, Sat 4 Oct 2025' })
      )

      await waitFor(() => expect(bar()).toHaveTextContent('0 selected'))
      // The deselect read the day's ids from the server again.
      expect(getGalleryMediaIdsMock).toHaveBeenLastCalledWith(
        'actor-1',
        expect.objectContaining({
          dayKey: '2025-10-04',
          limit: 2000,
          offset: 0
        })
      )
      expect(screen.getByTestId('album-toast')).toHaveTextContent(
        'Deselected 2 photos from Sat 4 Oct 2025'
      )
      expect(screen.getByTestId('added-announcement')).toHaveTextContent(
        'Deselected 2 photos'
      )
    })

    it('deselects the day including picks no loaded tile knows', async () => {
      // Only two of the day's three photos are loaded: Select day picked the
      // third from the ids read, but no loaded tile knows it. Deselect day
      // asks the server for the day's ids again, so it goes too.
      getGalleryMediaIdsMock.mockResolvedValue(['1', '2', '4'])
      getGalleryMediaMock.mockResolvedValue({
        items: [buildGalleryItem('4', { takenAt: '2025-10-04T11:30:00.000Z' })],
        days: { '2025-10-04': dayStats(3) },
        nextCursor: null,
        nextMaxId: null
      })
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: dayPhotos().slice(0, 2),
            nextMaxId: null,
            days: { '2025-10-04': dayStats(3, 'Box Hill, Surrey') }
          }}
        />
      )
      startSelecting()
      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )
      await waitFor(() => expect(bar()).toHaveTextContent('3 selected'))

      fireEvent.click(
        screen.getByRole('button', { name: 'Deselect day, Sat 4 Oct 2025' })
      )

      await waitFor(() => expect(bar()).toHaveTextContent('0 selected'))
      expect(getGalleryMediaIdsMock).toHaveBeenCalledTimes(2)
      expect(getGalleryMediaIdsMock).toHaveBeenLastCalledWith(
        'actor-1',
        expect.objectContaining({
          dayKey: '2025-10-04',
          limit: 2000,
          offset: 0
        })
      )
      expect(screen.getByTestId('album-toast')).toHaveTextContent(
        'Deselected 3 photos from Sat 4 Oct 2025'
      )

      fireEvent.click(
        within(screen.getByTestId('album-toast')).getByRole('button', {
          name: 'Undo'
        })
      )
      await waitFor(() => expect(bar()).toHaveTextContent('3 selected'))
    })

    it('shows an alert and keeps the selection when Select day fails', async () => {
      getGalleryMediaIdsMock.mockRejectedValue(new Error('Boom'))
      renderGrouped()
      startSelecting()

      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
      expect(bar()).toHaveTextContent('0 selected')
      expect(screen.queryByTestId('album-toast')).not.toBeInTheDocument()
    })

    it('retries the failed Select day from the alert', async () => {
      getGalleryMediaIdsMock.mockRejectedValueOnce(new Error('Boom'))
      getGalleryMediaIdsMock.mockResolvedValue(['1', '2'])
      renderGrouped()
      startSelecting()

      fireEvent.click(
        screen.getByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
      )
      expect(await screen.findByRole('alert')).toHaveTextContent('Boom')

      fireEvent.click(
        within(screen.getByRole('alert')).getByRole('button', {
          name: 'Retry'
        })
      )

      await waitFor(() => expect(bar()).toHaveTextContent('2 selected'))
      expect(getGalleryMediaIdsMock).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('album-toast')).toHaveTextContent(
        'Selected 2 photos from Sat 4 Oct 2025'
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('range-selects across two day groups with Shift', () => {
      renderGrouped()
      startSelecting()

      // The anchor is the first tile of the first day.
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))
      // Shift-clicking the only tile of the second day spans both headers.
      fireEvent.click(screen.getByRole('button', { name: 'Shift-select 3' }))

      expect(bar()).toHaveTextContent('3 selected')
      expect(screen.getByTestId('added-announcement')).toHaveTextContent(
        'Selected 2 photos'
      )
    })

    it('unpicks a run across two day groups when the anchor was unpicked', () => {
      renderGrouped()
      startSelecting()

      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Select 3' }))
      // Unpick the anchor: a Shift-toggle from it now unpicks the run.
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))
      expect(bar()).toHaveTextContent('1 selected')

      fireEvent.click(screen.getByRole('button', { name: 'Shift-select 3' }))

      expect(bar()).toHaveTextContent('0 selected')
      expect(screen.getByTestId('added-announcement')).toHaveTextContent(
        'Deselected 1 photo'
      )
    })
  })

  describe('filters and facets', () => {
    it('sends sort=taken_desc on grid requests by default', async () => {
      getGalleryMediaMock.mockResolvedValue({
        items: [buildGalleryItem('10')],
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
        expect(getGalleryMediaMock).toHaveBeenCalledWith(
          'actor-1',
          expect.objectContaining({ sort: 'taken_desc' })
        )
      )
    })

    it('remounts the grid with the query and keeps selection when filter changes', async () => {
      getGalleryMediaMock.mockResolvedValue({
        items: [buildGalleryItem('1'), buildGalleryItem('2')],
        nextMaxId: null
      })
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: [buildGalleryItem('1'), buildGalleryItem('2')],
            nextMaxId: null
          }}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Select' }))
      fireEvent.click(screen.getByRole('button', { name: 'Select 1' }))

      const bar = screen.getByRole('region', { name: 'Selection' })
      expect(bar).toHaveTextContent('1 selected')

      fireEvent.click(screen.getByRole('button', { name: 'Filter lions' }))

      await waitFor(() =>
        expect(getGalleryMediaMock).toHaveBeenCalledWith(
          'actor-1',
          expect.objectContaining({
            subject: 'sci:panthera leo',
            sort: 'taken_desc'
          })
        )
      )

      expect(bar).toHaveTextContent('1 selected')
      expect(screen.getByRole('button', { name: 'Select 1' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    it('refetches facets when show changes', async () => {
      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
        />
      )

      await waitFor(() =>
        expect(getGalleryMediaFacetsMock).toHaveBeenCalledWith({ show: 'all' })
      )

      const group = screen.getByRole('group', { name: 'Show' })
      fireEvent.keyDown(group.querySelector('button')!, { key: 'ArrowDown' })
      fireEvent.click(
        await screen.findByRole('menuitem', { name: /^Hidden from gallery/ })
      )

      await waitFor(() =>
        expect(getGalleryMediaFacetsMock).toHaveBeenLastCalledWith({
          show: 'hidden'
        })
      )
    })

    it('passes total from the first page to the filter bar and wires countDraft', async () => {
      getGalleryMediaMock.mockResolvedValue({
        items: [buildGalleryItem('8')],
        nextMaxId: null,
        total: 142
      })

      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: [buildGalleryItem('5')],
            nextMaxId: null,
            total: 42
          }}
        />
      )

      expect(filterBarProps.current?.total).toBe(42)
      expect(screen.getByTestId('filter-bar')).toHaveAttribute(
        'data-total',
        '42'
      )

      // Reload to verify total updates from subsequent page response
      const nav = screen.getByRole('navigation', { name: 'Category' })
      fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Mammals' }))

      await waitFor(() => {
        expect(filterBarProps.current?.total).toBe(142)
        expect(screen.getByTestId('filter-bar')).toHaveAttribute(
          'data-total',
          '142'
        )
      })

      await filterBarProps.current?.countDraft?.(EMPTY_GALLERY_FILTERS)
      expect(countGalleryMediaMock).toHaveBeenCalledWith(
        'actor-1',
        expect.objectContaining({ show: 'all', category: 'mammal' })
      )
    })

    it('renders filtered empty state when items are empty and filters are active', async () => {
      getGalleryMediaMock.mockResolvedValue({
        items: [],
        nextMaxId: null
      })

      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: [buildGalleryItem('1')],
            nextMaxId: null
          }}
        />
      )

      expect(screen.queryByTestId('filter-empty')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Filter lions' }))

      await waitFor(() => {
        expect(screen.getByTestId('filter-empty')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

      await waitFor(() => {
        expect(screen.queryByTestId('filter-empty')).not.toBeInTheDocument()
      })
    })

    it('preserves unfiltered empty titles when hasFilters is false', () => {
      const { unmount } = render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory={null}
          initialShow="all"
          initialPage={{
            items: [],
            nextMaxId: null
          }}
        />
      )

      expect(screen.getByText('No photos or videos yet')).toBeInTheDocument()
      expect(screen.queryByTestId('filter-empty')).not.toBeInTheDocument()
      unmount()

      render(
        <GalleryAllMediaView
          actorId="actor-1"
          initialCategory="mammal"
          initialShow="all"
          initialPage={{
            items: [],
            nextMaxId: null
          }}
        />
      )

      expect(screen.getByText('No mammals yet')).toBeInTheDocument()
      expect(screen.queryByTestId('filter-empty')).not.toBeInTheDocument()
    })
  })
})
