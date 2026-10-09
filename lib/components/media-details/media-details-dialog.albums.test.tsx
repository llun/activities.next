/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

import { addGalleryAlbumItems, updateMediaDetails } from '@/lib/client'

import {
  addAlbumItemsMock,
  gears,
  getGalleryGearsMock,
  getMediaAlbumsMock,
  getMediaMock,
  makeItem,
  renderDialog,
  updateMediaDetailsMock
} from './media-details-dialog.helpers'

vi.mock('@/lib/client', () => ({
  addGalleryAlbumItems: vi.fn(),
  getMediaAlbums: vi.fn(),
  removeGalleryAlbumItems: vi.fn(),
  createGalleryGear: vi.fn(),
  describeMedia: vi.fn(),
  getGalleryGears: vi.fn(),
  getMedia: vi.fn(),
  retryMediaLookups: vi.fn(),
  searchGalleryTaxa: vi.fn(),
  suggestMediaSubjects: vi.fn(),
  updateMediaDetails: vi.fn(),
  TaxaSearchUnavailableError: class extends Error {}
}))

describe('MediaDetailsDialog albums', () => {
  const originalResizeObserver = global.ResizeObserver

  const albumsFor = (albumIds: string[] = ['a1']) => ({
    albums: [
      {
        id: 'a1',
        title: 'Kruger',
        visibility: 'public' as const,
        itemCount: 3
      },
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

  beforeEach(() => {
    vi.clearAllMocks()
    getGalleryGearsMock.mockResolvedValue(gears)
    getMediaMock.mockImplementation(() => new Promise(() => {}))
    updateMediaDetailsMock.mockImplementation(
      async (id, fields) =>
        ({
          id,
          description: (fields.description as string | null | undefined) ?? null
        }) as unknown as Awaited<ReturnType<typeof updateMediaDetails>>
    )
    getMediaAlbumsMock.mockResolvedValue(albumsFor())
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  it('has no Albums section, and asks for nothing, without an owner', () => {
    renderDialog([makeItem('a')])

    expect(screen.queryByText('Albums')).not.toBeInTheDocument()
    expect(getMediaAlbumsMock).not.toHaveBeenCalled()
  })

  it('shows the owner their albums for the photo, with copy that they save at once', async () => {
    renderDialog([makeItem('a')], { ownerId: 'owner' })

    expect(await screen.findByText('Albums')).toBeInTheDocument()
    expect(getMediaAlbumsMock).toHaveBeenCalledWith('a')
    expect(
      await screen.findByRole('list', { name: 'Albums holding this photo' })
    ).toHaveTextContent('Kruger')
    expect(
      screen.getByText(
        /Albums apply right away\. They are not part of Save details\./
      )
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add to album' })).toBeVisible()
  })

  it('shows no Albums section for a photo that is not the caller’s', async () => {
    getMediaAlbumsMock.mockResolvedValue(null)
    renderDialog([makeItem('a')], { ownerId: 'owner' })

    await waitFor(() => expect(getMediaAlbumsMock).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText('Albums')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Add to album' })
    ).not.toBeInTheDocument()
  })

  it('saves an album change on the spot and leaves the dialog with nothing to save', async () => {
    addAlbumItemsMock.mockResolvedValue({
      added: ['a'],
      existing: [],
      skipped: [],
      album: {
        id: 'a2',
        title: 'Garden birds',
        itemCount: 2
      } as Awaited<ReturnType<typeof addGalleryAlbumItems>>['album']
    })
    const { onClose, onSaved } = renderDialog([makeItem('a')], {
      ownerId: 'owner'
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Add to album' }))
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })
    fireEvent.click(
      within(menu).getByRole('checkbox', { name: /^Garden birds/ })
    )

    await screen.findByTestId('album-toast')
    expect(addAlbumItemsMock).toHaveBeenCalledWith('a2', ['a'])

    // Save details sees no change: no request, nothing reported as saved.
    fireEvent.keyDown(menu, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('keeps the details edits apart from the album change when saving', async () => {
    addAlbumItemsMock.mockResolvedValue({
      added: ['a'],
      existing: [],
      skipped: [],
      album: { id: 'a2', title: 'Garden birds', itemCount: 2 } as Awaited<
        ReturnType<typeof addGalleryAlbumItems>
      >['album']
    })
    const { onClose } = renderDialog([makeItem('a')], { ownerId: 'owner' })

    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'A heron at dawn' }
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Add to album' }))
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })
    fireEvent.click(
      within(menu).getByRole('checkbox', { name: /^Garden birds/ })
    )
    await screen.findByTestId('album-toast')
    fireEvent.keyDown(menu, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
      description: 'A heron at dawn'
    })
  })

  it('closes only the menu on Escape, not the dialog', async () => {
    const { onClose } = renderDialog([makeItem('a')], { ownerId: 'owner' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add to album' }))
    const menu = await screen.findByRole('dialog', { name: 'Add to album' })

    fireEvent.keyDown(menu, { key: 'Escape' })

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Add to album' })
      ).not.toBeInTheDocument()
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(
      screen.getByRole('dialog', { name: 'Media details' })
    ).toBeInTheDocument()
  })

  it('reads the albums of the next photo when the selection moves', async () => {
    getMediaAlbumsMock.mockImplementation(async (id) =>
      id === 'a' ? albumsFor(['a1']) : albumsFor([])
    )
    renderDialog([makeItem('a'), makeItem('b')], { ownerId: 'owner' })
    expect(
      await screen.findByRole('list', { name: 'Albums holding this photo' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next item' }))

    expect(await screen.findByText('Not in any album yet.')).toBeVisible()
    expect(getMediaAlbumsMock).toHaveBeenLastCalledWith('b')
  })
})
