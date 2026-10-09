/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { addGalleryAlbumItems, getGalleryAlbums } from '@/lib/client'
import { GalleryAlbumAddError } from '@/lib/client/galleryAlbums'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { createDeferred } from '@/lib/testing/deferred'
import { GALLERY_ALBUM_FULL_MESSAGE } from '@/lib/types/database/galleryAlbums'

import { GalleryAddToAlbumDialog } from './GalleryAddToAlbumDialog'

vi.mock('@/lib/client', async () => ({
  GalleryAlbumAddError: (
    await vi.importActual<typeof import('@/lib/client/galleryAlbums')>(
      '@/lib/client/galleryAlbums'
    )
  ).GalleryAlbumAddError,
  addGalleryAlbumItems: vi.fn(),
  getGalleryAlbums: vi.fn()
}))

const getAlbumsMock = vi.mocked(getGalleryAlbums)
const addMock = vi.mocked(addGalleryAlbumItems)

const albums = [
  buildAlbumCard('a1', { title: 'Kruger', itemCount: 14 }),
  buildAlbumCard('a2', {
    title: 'Garden birds',
    itemCount: 1,
    visibility: 'private'
  }),
  buildAlbumCard('a3', { title: 'Kruger', itemCount: 14 })
]

const outcome = (overrides = {}) => ({
  added: ['m1', 'm2'],
  existing: [],
  skipped: [],
  album: albums[0],
  ...overrides
})

const renderDialog = (
  props: Partial<React.ComponentProps<typeof GalleryAddToAlbumDialog>> = {}
) => {
  const handlers = {
    onOpenChange: vi.fn(),
    onNewAlbum: vi.fn(),
    onAdded: vi.fn()
  }
  render(
    <GalleryAddToAlbumDialog
      open
      mediaIds={['m1', 'm2']}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

describe('GalleryAddToAlbumDialog', () => {
  beforeEach(() => {
    getAlbumsMock.mockReset()
    addMock.mockReset()
    getAlbumsMock.mockResolvedValue({ albums, photoCount: 20 })
  })

  it('names the count and lists the albums with unique names', async () => {
    renderDialog()

    expect(
      screen.getByRole('heading', { name: 'Add 2 photos to an album' })
    ).toBeVisible()
    const radios = await screen.findAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
      'Kruger, public album, 14 photos, number 1',
      'Garden birds, private album, 1 photo',
      'Kruger, public album, 14 photos, number 2'
    ])
    expect(screen.getByRole('button', { name: 'Add 2 photos' })).toBeDisabled()
  })

  it('says photo in the singular for one photo', async () => {
    renderDialog({ mediaIds: ['m1'] })

    expect(
      screen.getByRole('heading', { name: 'Add 1 photo to an album' })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'New album with this photo' })
    ).toBeVisible()
    await screen.findAllByRole('radio')
  })

  it('picks an album from a tap anywhere on its row', async () => {
    renderDialog()

    const radios = await screen.findAllByRole('radio')
    // The count and the title are part of the row's label, not dead space.
    fireEvent.click(screen.getByText('1'))
    expect(radios[1]).toBeChecked()
    fireEvent.click(screen.getAllByText('Kruger')[0])
    expect(radios[0]).toBeChecked()
    expect(radios[1]).not.toBeChecked()
  })

  it('adds the selection to the chosen album and reports what happened', async () => {
    addMock.mockResolvedValue(outcome())
    const { onAdded, onOpenChange } = renderDialog()

    fireEvent.click(await screen.findByRole('radio', { name: /^Garden/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 photos' }))

    await waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith({
        albumId: 'a2',
        message: 'Added 2 photos to “Garden birds”.'
      })
    )
    expect(addMock).toHaveBeenCalledWith('a2', ['m1', 'm2'])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reports skipped and already-added photos', async () => {
    addMock.mockResolvedValue(
      outcome({ added: ['m1'], existing: ['m2'], skipped: ['m3'] })
    )
    const { onAdded } = renderDialog({ mediaIds: ['m1', 'm2', 'm3'] })

    fireEvent.click(await screen.findByRole('radio', { name: /^Garden/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 photos' }))

    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(onAdded.mock.calls[0][0].message).toBe(
      'Added 1 photo to “Garden birds”. 1 photo was already there. 1 photo couldn’t be added: it isn’t in your gallery any more.'
    )
  })

  it('stays open and says how far it got when the album fills up', async () => {
    addMock.mockRejectedValue(
      new GalleryAlbumAddError(
        GALLERY_ALBUM_FULL_MESSAGE,
        422,
        outcome({ added: ['m1'] })
      )
    )
    const { onAdded, onOpenChange } = renderDialog({
      mediaIds: ['m1', 'm2', 'm3']
    })

    fireEvent.click(await screen.findByRole('radio', { name: /^Garden/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 photos' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '“Garden birds” is full: an album holds at most 2,000 photos. Added 1 of 3. The other 2 photos were not added.'
    )
    expect(onAdded).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    // The owner can pick another album and go on.
    expect(screen.getByRole('button', { name: 'Add 3 photos' })).toBeEnabled()
  })

  it('shows any other failure and lets the owner try again', async () => {
    addMock.mockRejectedValueOnce(new Error('Server is down'))
    addMock.mockResolvedValueOnce(outcome())
    const { onAdded } = renderDialog()

    fireEvent.click(await screen.findByRole('radio', { name: /^Garden/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 photos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t finish adding to “Garden birds”. Server is down. Nothing was added.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add 2 photos' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
  })

  it('cannot be closed while the add is running', async () => {
    const pending = createDeferred<ReturnType<typeof outcome>>()
    addMock.mockReturnValue(pending.promise)
    const { onOpenChange } = renderDialog()

    fireEvent.click(await screen.findByRole('radio', { name: /^Garden/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 photos' }))

    expect(
      await screen.findByRole('button', { name: 'Adding…' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()

    pending.resolve(outcome())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('hands over to New album', async () => {
    const { onNewAlbum } = renderDialog()

    fireEvent.click(
      screen.getByRole('button', { name: 'New album with these photos' })
    )

    expect(onNewAlbum).toHaveBeenCalledTimes(1)
    await screen.findAllByRole('radio')
  })

  it('offers only a new album when there are no albums', async () => {
    getAlbumsMock.mockResolvedValue({ albums: [], photoCount: 0 })
    renderDialog()

    expect(await screen.findByText(/no albums yet/)).toBeVisible()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('reports a failed album list and tries again', async () => {
    getAlbumsMock.mockRejectedValueOnce(new Error('Server is down'))
    renderDialog()

    expect(await screen.findByRole('alert')).toHaveTextContent('Server is down')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findAllByRole('radio')).toHaveLength(3)
  })

  it('closes from Cancel', async () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    await screen.findAllByRole('radio')
  })

  it('does not read the albums while closed', () => {
    renderDialog({ open: false })

    expect(getAlbumsMock).not.toHaveBeenCalled()
  })
})
