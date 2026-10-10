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
  render(
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
  return { onClosed }
}

// The pill lives in the info overlay, which starts hidden.
const openDetails = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Details' }))

const findPill = async (name = 'In 1 album') => {
  openDetails()
  return screen.findByRole('button', { name })
}

describe('MediasModal albums pill', () => {
  beforeEach(() => {
    getMediaAlbumsMock.mockReset()
    getDetailsMock.mockReset()
    addMock.mockReset()
    getMediaAlbumsMock.mockResolvedValue(albumsResponse())
    getDetailsMock.mockResolvedValue(null)
  })

  it('has no pill, no Details button, and asks for nothing, without an owner', async () => {
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

  it('shows how many albums hold the photo being viewed, for that photo only', async () => {
    renderModal()

    expect(await findPill()).toBeVisible()
    expect(getMediaAlbumsMock).toHaveBeenCalledTimes(1)
    expect(getMediaAlbumsMock).toHaveBeenCalledWith('m1')
  })

  it('asks again for the next photo', async () => {
    getMediaAlbumsMock.mockImplementation(async (id) =>
      id === 'm1' ? albumsResponse(['a1']) : albumsResponse([])
    )
    renderModal()
    await findPill()

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(
      await screen.findByRole('button', { name: 'Add to album' })
    ).toBeVisible()
    expect(getMediaAlbumsMock).toHaveBeenLastCalledWith('m2')
    expect(
      screen.queryByRole('button', { name: 'In 1 album' })
    ).not.toBeInTheDocument()
  })

  it('keeps the pill out of sight and the accessibility tree until Details is pressed', async () => {
    renderModal()

    await act(async () => {})
    expect(getMediaAlbumsMock).toHaveBeenCalledWith('m1')
    expect(
      screen.queryByRole('button', { name: 'In 1 album' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'In 1 album', hidden: true })
    ).not.toBeVisible()

    expect(await findPill()).toBeVisible()
  })

  it('shows a skeleton in the overlay while the albums load', async () => {
    getMediaAlbumsMock.mockReturnValue(new Promise(() => {}))
    renderModal()
    openDetails()

    const region = screen.getByRole('region', { name: 'Photo details' })
    expect(
      region.querySelector('[data-slot="skeleton-bar"]')
    ).toBeInTheDocument()
  })

  it('keeps the albums control mounted while Details is closed', async () => {
    renderModal()
    const pill = await findPill()

    openDetails()

    expect(pill).toBeInTheDocument()
    expect(pill).not.toBeVisible()
    expect(getMediaAlbumsMock).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the Details button when the pill remounts for the next photo', async () => {
    renderModal()
    const pill = await findPill()
    pill.focus()
    expect(pill).toHaveFocus()

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus()
    )
  })

  it('shows no pill for a photo that is not the caller’s', async () => {
    getMediaAlbumsMock.mockResolvedValue(null)
    renderModal()
    openDetails()

    await waitFor(() => expect(getMediaAlbumsMock).toHaveBeenCalled())
    await act(async () => {})
    expect(
      screen.queryByRole('button', { name: /album/i })
    ).not.toBeInTheDocument()
  })

  it('adds from the menu and the pill counts it', async () => {
    addMock.mockResolvedValue({
      added: ['m1'],
      existing: [],
      skipped: [],
      album: buildAlbumCard('a2', { itemCount: 2 })
    })
    renderModal()

    fireEvent.click(await findPill())
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

  it('closes only the menu on Escape, then the overlay, and the viewer after', async () => {
    const { onClosed } = renderModal()
    fireEvent.click(await findPill())
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

    // The overlay is still open: the next Escape closes it, then the viewer.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClosed).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('leaves the arrow keys to the menu instead of changing the photo', async () => {
    renderModal()
    fireEvent.click(await findPill())
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
    await findPill()

    fireEvent.keyDown(document.body, { key: 'ArrowRight' })

    await waitFor(() =>
      expect(getMediaAlbumsMock).toHaveBeenLastCalledWith('m2')
    )
  })

  it('opens its menu inside the modal viewer so a screen reader keeps it', async () => {
    renderModal()
    fireEvent.click(await findPill())
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
      fireEvent.click(await findPill())
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
      await findPill()
      const image = document.querySelector('img')!

      fireEvent.touchStart(image, { touches: [{ clientX: 300 }] })
      fireEvent.touchMove(image, { touches: [{ clientX: 100 }] })
      fireEvent.touchEnd(image)

      expect(track().style.transition).toContain('transform')
    })

    it('closes only the menu when the backdrop is pressed, then the viewer on the next press', async () => {
      const { onClosed } = renderModal()
      fireEvent.click(await findPill())
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

      // The overlay is still open: the next press closes it, then the viewer.
      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
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
      fireEvent.click(await findPill())
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

      // The next press on the backdrop is a real one: it closes the menu only
      // (as before), and the one after that closes the viewer.
      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Add to album' })
        ).not.toBeInTheDocument()
      )
      // Then the overlay, then the viewer.
      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
      expect(onClosed).not.toHaveBeenCalled()
      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
      expect(onClosed).toHaveBeenCalledTimes(1)
    })

    it('does not count a press inside the menu as one that closed it', async () => {
      const { onClosed } = renderModal()
      fireEvent.click(await findPill())
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

      // The overlay is still open: the backdrop closes it first.
      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
      expect(onClosed).not.toHaveBeenCalled()
      fireEvent.pointerDown(backdrop)
      fireEvent.click(backdrop)
      expect(onClosed).toHaveBeenCalledTimes(1)
    })
  })

  it('tells its host which album the pill changed', async () => {
    addMock.mockResolvedValue({
      added: ['m1'],
      existing: [],
      skipped: [],
      album: buildAlbumCard('a2', { itemCount: 2 })
    })
    const onAlbumsChange = vi.fn()
    renderModal({ onAlbumsChange })

    fireEvent.click(await findPill())
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })
    fireEvent.click(
      within(menu).getByRole('checkbox', { name: /^Garden birds/ })
    )

    await waitFor(() => expect(onAlbumsChange).toHaveBeenCalledWith('a2'))
  })
})
