/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen, waitFor } from '@testing-library/react'

import { getGallerySettings, getMedia } from '@/lib/client'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type {
  MediaDetailsDialogItem,
  MediaDetailsSavedItem
} from '@/lib/components/media-details/media-details-dialog'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import type {
  MediaDetailsEntity,
  MediaStorageSaveFileOutput
} from '@/lib/services/medias/types'
import { DEFAULT_GALLERY_SETTINGS } from '@/lib/types/database/gallery'

import { GalleryEditDetailsDialog } from './GalleryEditDetailsDialog'

vi.mock('@/lib/client', () => ({
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
  onMediaEdited: (
    id: string,
    media: MediaStorageSaveFileOutput,
    posts: { updated: string[]; skipped: string[] }
  ) => void
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

  it('shows the edited file on the tile, then the original after a revert', async () => {
    const onSaved = vi.fn()
    const base = buildGalleryItem('1', {
      attachment: {
        ...buildGalleryItem('1').attachment,
        width: 4000,
        height: 3000,
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focus: { x: 0.5, y: 0.5 }
      }
    })
    render(
      <GalleryEditDetailsDialog
        items={[base]}
        initialMediaId="1"
        ownerId={OWNER}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    )
    const entity = (
      overrides: Partial<MediaStorageSaveFileOutput>
    ): MediaStorageSaveFileOutput => ({
      id: '1',
      type: 'image',
      mime_type: 'image/webp',
      url: 'https://activities.local/api/v1/files/medias/render.webp',
      preview_url: 'https://activities.local/api/v1/files/medias/render.webp',
      text_url: null,
      remote_url: null,
      preview_remote_url: null,
      meta: {
        original: { width: 1200, height: 1200, size: '1200x1200', aspect: 1 }
      },
      description: null,
      blurhash: null,
      ...overrides
    })
    const posts = { updated: [], skipped: [] }

    // The crop's render has no BlurHash and no focal point of its own.
    act(() => latest().onMediaEdited('1', entity({}), posts))
    expect(onSaved).toHaveBeenLastCalledWith([
      expect.objectContaining({
        mediaId: '1',
        attachment: expect.objectContaining({
          url: 'https://activities.local/api/v1/files/medias/render.webp',
          width: 1200,
          height: 1200,
          blurhash: null,
          focus: null,
          thumbnailUrl:
            'https://activities.local/api/v1/files/medias/render.webp'
        })
      })
    ])

    act(() =>
      latest().onMediaEdited(
        '1',
        entity({
          mime_type: 'image/jpeg',
          url: 'https://activities.local/api/v1/files/medias/1.jpg',
          preview_url: 'https://activities.local/api/v1/files/medias/1-s.jpg',
          meta: {
            original: {
              width: 4000,
              height: 3000,
              size: '4000x3000',
              aspect: 4 / 3
            },
            focus: { x: -0.25, y: 0.4 }
          },
          blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH'
        }),
        posts
      )
    )
    expect(onSaved).toHaveBeenLastCalledWith([
      expect.objectContaining({
        attachment: expect.objectContaining({
          url: 'https://activities.local/api/v1/files/medias/1.jpg',
          width: 4000,
          height: 3000,
          blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
          focus: { x: -0.25, y: 0.4 },
          thumbnailUrl: 'https://activities.local/api/v1/files/medias/1-s.jpg'
        })
      })
    ])
  })

  it('passes close through', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })

    latest().onClose()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
