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

import {
  addGalleryAlbumItems,
  getMediaAlbums,
  getMediaPublicDetails
} from '@/lib/client'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { PlaybackPreferencesProvider } from '@/lib/components/preferences/PlaybackPreferencesContext'
import { Attachment } from '@/lib/types/domain/attachment'

import { MediasModal } from './medias-modal'

vi.mock('@/lib/client', () => ({
  addGalleryAlbumItems: vi.fn(),
  getMediaAlbums: vi.fn(),
  getMediaPublicDetails: vi.fn(),
  removeGalleryAlbumItems: vi.fn()
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

const getMediaAlbumsMock = vi.mocked(getMediaAlbums)
const getDetailsMock = vi.mocked(getMediaPublicDetails)
const addMock = vi.mocked(addGalleryAlbumItems)

const time = new Date('2026-04-26T10:00:00.000Z').getTime()

const photo = (mediaId: string): Attachment => ({
  id: `attachment-${mediaId}`,
  actorId: 'https://activities.local/users/llun',
  statusId: `https://activities.local/users/llun/statuses/${mediaId}`,
  type: 'Document',
  mediaType: 'image/jpeg',
  url: `https://activities.local/media/${mediaId}.jpg`,
  mediaId,
  name: '',
  createdAt: time,
  updatedAt: time
})

const albumsResponse = (albumIds: string[] = ['a1']) => ({
  albums: [
    { id: 'a1', title: 'Kruger', visibility: 'public' as const, itemCount: 3 },
    {
      id: 'a2',
      title: 'Garden birds',
      visibility: 'private' as const,
      itemCount: 1
    }
  ],
  albumIds,
  addable: true
})

const renderModal = (
  props: Partial<React.ComponentProps<typeof MediasModal>> = {}
) => {
  const onClosed = vi.fn()
  const result = render(
    <PlaybackPreferencesProvider initialAutoplayGifs={false}>
      <MediasModal
        medias={[photo('m1'), photo('m2')]}
        initialSelection={0}
        albumsOwnerId="owner"
        onClosed={onClosed}
        {...props}
      />
    </PlaybackPreferencesProvider>
  )
  return { onClosed, ...result }
}

const findAlbumsButton = async (name: string | RegExp = /album/i) =>
  screen.findByRole('button', { name })

describe('MediasModal albums button', () => {
  beforeEach(() => {
    getMediaAlbumsMock.mockReset()
    getDetailsMock.mockReset()
    addMock.mockReset()
    getMediaAlbumsMock.mockResolvedValue(albumsResponse())
    getDetailsMock.mockResolvedValue(null)
  })

  it('has no albums button, no Details button, and asks for nothing, without an owner', async () => {
    renderModal({ albumsOwnerId: undefined })

    await act(async () => {})
    expect(screen.getByText('Details').closest('button')).toHaveClass(
      'invisible'
    )
    expect(
      screen.queryByRole('button', { name: /album/i })
    ).not.toBeInTheDocument()
    expect(getMediaAlbumsMock).not.toHaveBeenCalled()
  })

  it('places the albums button in the header between Details and Edit, and loads without opening Details', async () => {
    const onEdit = vi.fn()
    const photoWithAlt = (mediaId: string): Attachment => ({
      ...photo(mediaId),
      name: 'Alt text'
    })
    renderModal({
      medias: [photoWithAlt('m1'), photoWithAlt('m2')],
      onEdit,
      canEdit: () => true
    })

    const details = screen.getByRole('button', { name: 'Details' })
    const albums = await findAlbumsButton('In 1 album')
    const edit = screen.getByRole('button', { name: 'Edit' })
    const close = screen.getByRole('button', { name: 'Close media dialog' })
    const header = close.parentElement!

    expect(header).toContainElement(details)
    expect(header).toContainElement(albums)
    expect(header).toContainElement(edit)
    expect(header).toContainElement(close)

    expect(
      details.compareDocumentPosition(albums) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      albums.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      edit.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()
  })

  it('names the button "Add to album" or "In 2 albums"', async () => {
    getMediaAlbumsMock.mockResolvedValueOnce(albumsResponse([]))
    const { unmount } = renderModal()

    expect(
      await screen.findByRole('button', { name: 'Add to album' })
    ).toBeVisible()
    unmount()

    getMediaAlbumsMock.mockResolvedValueOnce(albumsResponse(['a1', 'a2']))
    renderModal()

    expect(
      await screen.findByRole('button', { name: 'In 2 albums' })
    ).toBeVisible()
  })

  it('opens the menu from the albums button', async () => {
    renderModal()
    const button = await findAlbumsButton()
    fireEvent.click(button)

    expect(
      await screen.findByRole('dialog', { name: 'Add to album' })
    ).toBeVisible()
  })

  it('keeps the Details button hidden for an owner photo with no alt text and no details', async () => {
    renderModal()
    await findAlbumsButton()

    const details = screen.getByText('Details').closest('button')
    expect(details).toHaveClass('invisible')
    expect(details).toHaveAttribute('aria-hidden', 'true')
    expect(details).toHaveAttribute('tabindex', '-1')
  })

  it('shows how many albums hold the photo being viewed, for that photo only', async () => {
    renderModal()

    expect(await findAlbumsButton('In 1 album')).toBeVisible()
    expect(getMediaAlbumsMock).toHaveBeenCalledTimes(1)
    expect(getMediaAlbumsMock).toHaveBeenCalledWith('m1')
  })

  it('asks again for the next photo', async () => {
    getMediaAlbumsMock.mockImplementation(async (id) =>
      id === 'm1' ? albumsResponse(['a1']) : albumsResponse([])
    )
    renderModal()
    await findAlbumsButton('In 1 album')

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(
      await screen.findByRole('button', { name: 'Add to album' })
    ).toBeVisible()
    expect(getMediaAlbumsMock).toHaveBeenLastCalledWith('m2')
    expect(
      screen.queryByRole('button', { name: 'In 1 album' })
    ).not.toBeInTheDocument()
  })

  it('shows a skeleton in the header while the albums load', async () => {
    getMediaAlbumsMock.mockReturnValue(new Promise(() => {}))
    renderModal()

    const close = screen.getByRole('button', { name: 'Close media dialog' })
    const header = close.parentElement!
    expect(
      header.querySelector('[data-slot="skeleton-bar"]')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()
  })

  it('moves focus to Close when switching photos with no overlay content while albums button has focus', async () => {
    renderModal()
    const button = await findAlbumsButton()
    button.focus()
    expect(button).toHaveFocus()

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Close media dialog' })
      ).toHaveFocus()
    )
    expect(document.activeElement).not.toBe(document.body)
  })

  it('moves focus to Details when switching photos with overlay content while albums button has focus', async () => {
    const photoWithAlt = (mediaId: string): Attachment => ({
      ...photo(mediaId),
      name: 'Alt text for photo'
    })
    renderModal({ medias: [photoWithAlt('m1'), photoWithAlt('m2')] })
    const button = await findAlbumsButton()
    button.focus()
    expect(button).toHaveFocus()

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus()
    )
    expect(document.activeElement).not.toBe(document.body)
  })

  it('keeps focus off body when the Details button cannot take focus yet after the photo changes', async () => {
    // A browser refuses focus() on a button that is still `visibility: hidden`
    // for the first frame of its hidden-to-visible transition: that is the
    // Details button when the next photo, unlike this one, has details.
    let resolveNext: (value: ReturnType<typeof albumsResponse>) => void = () =>
      undefined
    getMediaAlbumsMock.mockImplementation((mediaId) =>
      mediaId === 'm1'
        ? Promise.resolve(albumsResponse([]))
        : new Promise((resolve) => {
            resolveNext = resolve
          })
    )
    renderModal({ medias: [photo('m1'), { ...photo('m2'), name: 'Alt text' }] })
    const button = await findAlbumsButton('Add to album')
    button.focus()
    const details = screen.getByText('Details').closest('button')
    const focus = HTMLElement.prototype.focus
    const spy = vi
      .spyOn(HTMLElement.prototype, 'focus')
      .mockImplementation(function (this: HTMLElement, options) {
        if (this !== details) focus.call(this, options)
      })

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await act(async () => {})
    resolveNext(albumsResponse(['a1']))
    await findAlbumsButton('In 1 album')
    spy.mockRestore()

    expect(
      screen.getByRole('button', { name: 'Close media dialog' })
    ).toHaveFocus()
  })

  it('renders the Undo toast without changing the header height or showing in the overlay', async () => {
    addMock.mockResolvedValue({
      added: ['m1'],
      existing: [],
      skipped: [],
      album: buildAlbumCard('a2', { itemCount: 2 })
    })
    renderModal()

    fireEvent.click(await findAlbumsButton())
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })
    fireEvent.click(
      within(menu).getByRole('checkbox', { name: /^Garden birds/ })
    )

    // Close the menu so the feedback renders in the absolute wrapper
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Add to album' })
      ).not.toBeInTheDocument()
    )

    const toast = await screen.findByTestId('album-toast')
    expect(toast).toHaveTextContent('Added to “Garden birds”')
    const toastWrapper = toast.parentElement
    expect(toastWrapper?.className).toContain(
      'absolute top-full right-0 z-30 mt-2 w-72'
    )
    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()
  })

  it('shows no albums button for a photo that is not the caller’s', async () => {
    getMediaAlbumsMock.mockResolvedValue(null)
    renderModal()

    await waitFor(() => expect(getMediaAlbumsMock).toHaveBeenCalled())
    await act(async () => {})
    expect(
      screen.queryByRole('button', { name: /album/i })
    ).not.toBeInTheDocument()
  })

  it('adds from the menu and the button counts it', async () => {
    addMock.mockResolvedValue({
      added: ['m1'],
      existing: [],
      skipped: [],
      album: buildAlbumCard('a2', { itemCount: 2 })
    })
    renderModal()

    fireEvent.click(await findAlbumsButton())
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })
    fireEvent.click(
      within(menu).getByRole('checkbox', { name: /^Garden birds/ })
    )

    expect(
      await screen.findByRole('button', { name: 'In 2 albums' })
    ).toBeVisible()
    expect(addMock).toHaveBeenCalledWith('a2', ['m1'])
    expect(await screen.findByTestId('album-toast')).toHaveTextContent(
      'Added to “Garden birds”'
    )
  })

  it('closes only the menu on Escape, and the viewer after', async () => {
    const { onClosed } = renderModal()
    fireEvent.click(await findAlbumsButton())
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })
    const box = within(menu).getAllByRole('checkbox')[0]
    box.focus()

    fireEvent.keyDown(box, { key: 'Escape' })

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Add to album' })
      ).not.toBeInTheDocument()
    )
    expect(onClosed).not.toHaveBeenCalled()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('leaves the arrow keys to the menu instead of changing the photo', async () => {
    renderModal()
    fireEvent.click(await findAlbumsButton())
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })
    const [first, second] = within(menu).getAllByRole('checkbox')
    first.focus()

    fireEvent.keyDown(first, { key: 'ArrowDown' })
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    fireEvent.keyDown(second, { key: 'ArrowLeft' })

    expect(second).toHaveFocus()
    expect(getMediaAlbumsMock).toHaveBeenCalledTimes(1)
  })

  it('still changes photo with the arrow keys when the menu is closed', async () => {
    renderModal()
    await findAlbumsButton()

    fireEvent.keyDown(document.body, { key: 'ArrowRight' })

    await waitFor(() =>
      expect(getMediaAlbumsMock).toHaveBeenLastCalledWith('m2')
    )
  })

  it('opens its menu inside the modal viewer so a screen reader keeps it', async () => {
    renderModal()
    fireEvent.click(await findAlbumsButton())
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })

    expect(
      screen.getByRole('dialog', { name: 'Media viewer' }).contains(menu)
    ).toBe(true)
  })

  describe('touch and click from the menu', () => {
    const track = () =>
      document.querySelector<HTMLElement>('[style*="translateX"]')!

    it('does not swipe the photo from a flick that starts in the menu', async () => {
      renderModal()
      fireEvent.click(await findAlbumsButton())
      const menu = await screen.findByRole('dialog', { name: 'Add to album' })
      const title = within(menu).getByText('Add to album', { selector: 'p' })

      fireEvent.touchStart(title, { touches: [{ clientX: 300 }] })
      fireEvent.touchMove(title, { touches: [{ clientX: 100 }] })
      fireEvent.touchEnd(title)

      expect(track().style.transition).toBe('none')
      expect(track().style.transform).not.toContain('-100px')
    })

    it('still swipes from the photo itself', async () => {
      renderModal()
      await findAlbumsButton()
      const image = document.querySelector('img')!

      fireEvent.touchStart(image, { touches: [{ clientX: 300 }] })
      fireEvent.touchMove(image, { touches: [{ clientX: 100 }] })
      fireEvent.touchEnd(image)

      expect(track().style.transition).toContain('transform')
    })

    it('closes only the menu when the backdrop is pressed, then the viewer on the next press', async () => {
      const { onClosed } = renderModal()
      fireEvent.click(await findAlbumsButton())
      await screen.findByRole('dialog', { name: 'Add to album' })
      const backdrop = screen.getByRole('dialog', { name: 'Media viewer' })

      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)

      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Add to album' })
        ).not.toBeInTheDocument()
      )
      expect(onClosed).not.toHaveBeenCalled()

      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
      expect(onClosed).toHaveBeenCalledTimes(1)
    })

    it('closes the viewer from the backdrop as before when no menu is open', async () => {
      const { onClosed } = renderModal()
      const backdrop = screen.getByRole('dialog', { name: 'Media viewer' })

      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)

      expect(onClosed).toHaveBeenCalledTimes(1)
    })

    it('keeps the viewer open when a press inside the menu is released on the backdrop', async () => {
      const { onClosed } = renderModal()
      fireEvent.click(await findAlbumsButton())
      const menu = await screen.findByRole('dialog', { name: 'Add to album' })
      const backdrop = screen.getByRole('dialog', { name: 'Media viewer' })

      // A scrollbar drag that overshoots the menu: the click lands on the
      // common ancestor, the viewer's root.
      fireEvent.pointerDown(within(menu).getAllByRole('checkbox')[0])
      fireEvent.click(backdrop)

      expect(onClosed).not.toHaveBeenCalled()
      expect(
        screen.getByRole('dialog', { name: 'Add to album' })
      ).toBeInTheDocument()

      // The next press on the backdrop is a real one: it closes the menu only,
      // and the one after that closes the viewer.
      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Add to album' })
        ).not.toBeInTheDocument()
      )
      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
      expect(onClosed).toHaveBeenCalledTimes(1)
    })

    it('does not count a press inside the menu as one that closed it', async () => {
      const { onClosed } = renderModal()
      fireEvent.click(await findAlbumsButton())
      const menu = await screen.findByRole('dialog', { name: 'Add to album' })
      const backdrop = screen.getByRole('dialog', { name: 'Media viewer' })

      // A press inside the menu leaves it open and must not arm the swallow.
      fireEvent.pointerDown(within(menu).getAllByRole('checkbox')[0])
      fireEvent.pointerUp(menu)
      expect(
        screen.getByRole('dialog', { name: 'Add to album' })
      ).toBeInTheDocument()
      fireEvent.keyDown(menu, { key: 'Escape' })
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Add to album' })
        ).not.toBeInTheDocument()
      )

      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
      expect(onClosed).toHaveBeenCalledTimes(1)
    })
  })

  it('tells its host which album the button changed', async () => {
    addMock.mockResolvedValue({
      added: ['m1'],
      existing: [],
      skipped: [],
      album: buildAlbumCard('a2', { itemCount: 2 })
    })
    const onAlbumsChange = vi.fn()
    renderModal({ onAlbumsChange })

    fireEvent.click(await findAlbumsButton())
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })
    fireEvent.click(
      within(menu).getByRole('checkbox', { name: /^Garden birds/ })
    )

    await waitFor(() => expect(onAlbumsChange).toHaveBeenCalledWith('a2'))
  })
})
