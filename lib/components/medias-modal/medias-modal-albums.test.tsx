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

describe('MediasModal albums pill', () => {
  beforeEach(() => {
    getMediaAlbumsMock.mockReset()
    getDetailsMock.mockReset()
    addMock.mockReset()
    getMediaAlbumsMock.mockResolvedValue(albumsResponse())
    getDetailsMock.mockResolvedValue(null)
  })

  it('has no pill, and asks for nothing, without an owner', async () => {
    renderModal({ albumsOwnerId: undefined })

    await act(async () => {})
    expect(
      screen.queryByRole('button', { name: /album/i })
    ).not.toBeInTheDocument()
    expect(getMediaAlbumsMock).not.toHaveBeenCalled()
  })

  it('shows how many albums hold the photo being viewed, for that photo only', async () => {
    renderModal()

    expect(
      await screen.findByRole('button', { name: 'In 1 album' })
    ).toBeVisible()
    expect(getMediaAlbumsMock).toHaveBeenCalledTimes(1)
    expect(getMediaAlbumsMock).toHaveBeenCalledWith('m1')
  })

  it('asks again for the next photo', async () => {
    getMediaAlbumsMock.mockImplementation(async (id) =>
      id === 'm1' ? albumsResponse(['a1']) : albumsResponse([])
    )
    renderModal()
    await screen.findByRole('button', { name: 'In 1 album' })

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(
      await screen.findByRole('button', { name: 'Add to album' })
    ).toBeVisible()
    expect(getMediaAlbumsMock).toHaveBeenLastCalledWith('m2')
    expect(
      screen.queryByRole('button', { name: 'In 1 album' })
    ).not.toBeInTheDocument()
  })

  it('shows no pill for a photo that is not the caller’s', async () => {
    getMediaAlbumsMock.mockResolvedValue(null)
    renderModal()

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

    fireEvent.click(await screen.findByRole('button', { name: 'In 1 album' }))
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

  it('closes only the menu on Escape, and the viewer on the next', async () => {
    const { onClosed } = renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'In 1 album' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'In 1 album' }))
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
    await screen.findByRole('button', { name: 'In 1 album' })

    fireEvent.keyDown(document.body, { key: 'ArrowRight' })

    await waitFor(() =>
      expect(getMediaAlbumsMock).toHaveBeenLastCalledWith('m2')
    )
  })
})
