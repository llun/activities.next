/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { deleteUnpostedMedia, getGallerySettings, getMedia } from '@/lib/client'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type {
  MediaDetailsDialogItem,
  MediaDetailsSavedItem
} from '@/lib/components/media-details/media-details-dialog'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import { DEFAULT_GALLERY_SETTINGS } from '@/lib/types/database/gallery'

import { GalleryEditDetailsDialog } from './GalleryEditDetailsDialog'

vi.mock('@/lib/client', () => ({
  deleteUnpostedMedia: vi.fn(),
  getGallerySettings: vi.fn(),
  getMedia: vi.fn()
}))

interface DialogProps {
  context?: string
  items: MediaDetailsDialogItem[]
  initialId: string
  settings: unknown
  ownerId?: string
  onClose: () => void
  onSaved: (items: MediaDetailsSavedItem[]) => void
  onPostItem?: (id: string) => void
  onDeleteItem?: (id: string) => void
  onDetailsRefreshed: (
    id: string,
    patch: Partial<MediaDetailsEntity>,
    value: MediaDetailsEntity
  ) => void
}

const dialog = vi.hoisted(() => ({ props: null as unknown }))
const latest = () => dialog.props as DialogProps

vi.mock('@/lib/components/media-details/media-details-dialog', () => ({
  MediaDetailsDialog: (props: unknown) => {
    dialog.props = props
    return <div role="dialog" aria-label="Edit details" />
  }
}))

const getMediaMock = vi.mocked(getMedia)
const getSettingsMock = vi.mocked(getGallerySettings)

const OWNER = 'https://activities.local/users/llun'

const details = (inGallery: boolean): MediaDetailsEntity => ({
  subject: null,
  takenAt: null,
  camera: null,
  lens: null,
  exposure: null,
  place: null,
  inGallery,
  subjectSuggestions: null
})

const items = [
  buildGalleryItem('1', { inGallery: true }),
  buildGalleryItem('2', { inGallery: false }),
  buildGalleryItem('3', { inGallery: true })
]

const renderDialog = (
  props: Partial<{
    onClose: () => void
    onSaved: (items: GalleryItemEntity[]) => void
    initialMediaId: string
  }> = {}
) =>
  render(
    <GalleryEditDetailsDialog
      items={items}
      initialMediaId={props.initialMediaId ?? '1'}
      ownerId={OWNER}
      onClose={props.onClose ?? vi.fn()}
      onSaved={props.onSaved ?? vi.fn()}
    />
  )

describe('GalleryEditDetailsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dialog.props = null
    getSettingsMock.mockResolvedValue({
      ...DEFAULT_GALLERY_SETTINGS,
      altTextAvailable: true,
      subjectSuggestionsAvailable: false,
      subjectModel: null,
      speciesLookupsAvailable: false,
      placeLookupsAvailable: false
    })
    getMediaMock.mockImplementation(
      async (id: string) =>
        ({ id, details: details(id === '2') }) as unknown as Awaited<
          ReturnType<typeof getMedia>
        >
    )
  })

  it('opens the gallery dialog straight away, before any details arrive', () => {
    getMediaMock.mockImplementation(() => new Promise(() => {}))
    getSettingsMock.mockImplementation(() => new Promise(() => {}))
    renderDialog({ initialMediaId: '2' })

    expect(screen.getByRole('dialog', { name: 'Edit details' })).toBeVisible()
    const props = latest()
    expect(props.context).toBe('gallery')
    expect(props.initialId).toBe('2')
    expect(props.ownerId).toBe(OWNER)
    expect(props.settings).toBeNull()
    expect(props.items.map((item) => item.id)).toEqual(['1', '2', '3'])
    expect(props.items.every((item) => item.details === null)).toBe(true)
    expect(props.items[0].post).toEqual(
      expect.objectContaining({ statusId: 'status-1' })
    )
  })

  it('reads the opening photo first and then the rest', async () => {
    renderDialog({ initialMediaId: '3' })

    await waitFor(() => expect(getMediaMock).toHaveBeenCalledTimes(3))
    expect(getMediaMock.mock.calls.map(([id]) => id)).toEqual(['3', '1', '2'])
    await waitFor(() =>
      expect(latest().items.map((item) => item.details?.inGallery)).toEqual([
        false,
        true,
        false
      ])
    )
    expect(latest().settings).toEqual(
      expect.objectContaining({ altTextAvailable: true })
    )
  })

  it('still opens when a photo`s details cannot be read', async () => {
    getMediaMock.mockImplementation(async (id: string) => {
      if (id === '2') throw new Error('Nope')
      return { id, details: details(true) } as unknown as Awaited<
        ReturnType<typeof getMedia>
      >
    })
    renderDialog()

    await waitFor(() =>
      expect(latest().items.map((item) => item.details === null)).toEqual([
        false,
        true,
        false
      ])
    )
  })

  it('hands the saved tiles to the page', async () => {
    const onSaved = vi.fn()
    renderDialog({ onSaved })
    await waitFor(() => expect(getMediaMock).toHaveBeenCalledTimes(3))

    act(() =>
      latest().onSaved([
        {
          id: '2',
          description: 'Fresh alt',
          decorative: false,
          details: details(true)
        }
      ])
    )

    expect(onSaved).toHaveBeenCalledTimes(1)
    const [saved] = onSaved.mock.calls[0]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toEqual(
      expect.objectContaining({
        mediaId: '2',
        inGallery: true,
        attachment: expect.objectContaining({ name: 'Fresh alt' })
      })
    )
    // The saved details replace what the dialog holds for that photo.
    await waitFor(() => expect(latest().items[1].details?.inGallery).toBe(true))
  })

  it('applies a retried save on top of the tile the first save produced', async () => {
    const onSaved = vi.fn()
    renderDialog({ onSaved })
    await waitFor(() => expect(getMediaMock).toHaveBeenCalledTimes(3))
    const withSubject: MediaDetailsEntity = {
      ...details(true),
      subject: {
        name: 'Grey Heron',
        scientificName: 'Ardea cinerea',
        category: 'bird',
        taxonKey: null,
        taxonPath: null,
        iucnCategory: null,
        threatStatus: 'unchecked',
        lookupStatus: null,
        lookupAt: null,
        lookupStale: false
      }
    }

    // The first save went through for the details and failed for the alt text.
    act(() =>
      latest().onSaved([
        {
          id: '1',
          description: '',
          decorative: false,
          details: withSubject
        }
      ])
    )
    // The retry sends the alt text alone, so it comes back without details.
    act(() =>
      latest().onSaved([
        { id: '1', description: 'Heron at dawn', decorative: false }
      ])
    )

    const [retried] = onSaved.mock.calls[1][0]
    expect(retried.attachment.name).toBe('Heron at dawn')
    expect(retried.subject).toEqual(
      expect.objectContaining({ name: 'Grey Heron' })
    )
  })

  it('merges details the dialog refreshed on its own', async () => {
    renderDialog()
    await waitFor(() =>
      expect(latest().items.every((item) => item.details)).toBe(true)
    )

    act(() =>
      latest().onDetailsRefreshed(
        '1',
        { takenAt: '2025-01-01T00:00:00.000Z' },
        {
          ...details(false),
          takenAt: '2025-01-01T00:00:00.000Z'
        }
      )
    )

    expect(latest().items[0].details).toEqual(
      expect.objectContaining({
        takenAt: '2025-01-01T00:00:00.000Z',
        // Kept from what the dialog already held, not the refreshed entity.
        inGallery: false
      })
    )
  })

  it('passes close through', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })

    latest().onClose()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
  describe('photos added in Gallery and not posted yet', () => {
    const unposted = buildGalleryItem('9', { statusId: null, posted: false })

    const renderUnposted = (
      props: Partial<React.ComponentProps<typeof GalleryEditDetailsDialog>> = {}
    ) =>
      render(
        <GalleryEditDetailsDialog
          items={[unposted]}
          initialMediaId="9"
          ownerId={OWNER}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          {...props}
        />
      )

    it('marks the photo as unposted, with no post to link to', () => {
      renderUnposted()

      expect(latest().items[0]).toEqual(
        expect.objectContaining({ id: '9', unposted: true })
      )
      expect(latest().items[0].post).toBeUndefined()
    })

    it('offers Post… and Delete only when the page handles them', () => {
      const { unmount } = renderUnposted()
      expect(latest().onPostItem).toBeUndefined()
      expect(latest().onDeleteItem).toBeUndefined()
      unmount()

      renderUnposted({ onPost: vi.fn(), onDeleted: vi.fn() })
      expect(latest().onPostItem).toBeDefined()
      expect(latest().onDeleteItem).toBeDefined()
    })

    it('hands the photo to post', () => {
      const onPost = vi.fn()
      renderUnposted({ onPost })

      act(() => latest().onPostItem?.('9'))

      expect(onPost).toHaveBeenCalledWith(['9'])
    })

    it('confirms a delete, deletes the photo, tells the page and closes', async () => {
      vi.mocked(deleteUnpostedMedia).mockResolvedValue(undefined)
      const onDeleted = vi.fn()
      const onClose = vi.fn()
      renderUnposted({ onDeleted, onClose })

      act(() => latest().onDeleteItem?.('9'))
      const confirm = await screen.findByRole('dialog', {
        name: 'Delete 1 photo?'
      })
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Delete 1 photo' }))

      await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(['9']))
      expect(deleteUnpostedMedia).toHaveBeenCalledWith('9')
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(confirm).toBeDefined()
    })

    it('keeps the photo when the delete is cancelled', async () => {
      const onDeleted = vi.fn()
      const onClose = vi.fn()
      renderUnposted({ onDeleted, onClose })
      act(() => latest().onDeleteItem?.('9'))
      await screen.findByRole('dialog', { name: 'Delete 1 photo?' })

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Delete 1 photo?' })
        ).not.toBeInTheDocument()
      )
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
      expect(onDeleted).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
