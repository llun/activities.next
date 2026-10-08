/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  createGalleryGear,
  describeMedia,
  getGalleryGears,
  updateMediaDetails
} from '@/lib/client'
import type { GallerySettingsEntity } from '@/lib/services/gallery/galleryEntities'
import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import { DEFAULT_GALLERY_SETTINGS } from '@/lib/types/database/gallery'

import {
  MediaDetailsDialog,
  MediaDetailsDialogItem
} from './media-details-dialog'

vi.mock('@/lib/client', () => ({
  createGalleryGear: vi.fn(),
  describeMedia: vi.fn(),
  getGalleryGears: vi.fn(),
  updateMediaDetails: vi.fn()
}))

const describeMediaMock = vi.mocked(describeMedia)
const updateMediaDetailsMock = vi.mocked(updateMediaDetails)
const getGalleryGearsMock = vi.mocked(getGalleryGears)
const createGalleryGearMock = vi.mocked(createGalleryGear)

const emptyDetails: MediaDetailsEntity = {
  subject: null,
  takenAt: null,
  camera: null,
  lens: null,
  exposure: null,
  place: null,
  inGallery: false
}

const makeItem = (
  id: string,
  overrides: Partial<MediaDetailsDialogItem> = {}
): MediaDetailsDialogItem => ({
  id,
  mediaType: 'image/jpeg',
  url: `https://activities.local/files/${id}.jpg`,
  width: 800,
  height: 600,
  description: '',
  decorative: false,
  details: emptyDetails,
  ...overrides
})

const settings = (
  overrides: Partial<GallerySettingsEntity> = {}
): GallerySettingsEntity => ({
  ...DEFAULT_GALLERY_SETTINGS,
  altTextAvailable: true,
  ...overrides
})

const gears = [
  {
    id: 'cam-1',
    kind: 'camera' as const,
    name: 'Nikon Z9',
    brand: null,
    model: null,
    productUrl: null,
    retiredAt: null,
    createdAt: 1
  },
  {
    id: 'cam-old',
    kind: 'camera' as const,
    name: 'Retired body',
    brand: null,
    model: null,
    productUrl: null,
    retiredAt: 5,
    createdAt: 1
  },
  {
    id: 'lens-1',
    kind: 'lens' as const,
    name: '400mm f/2.8',
    brand: null,
    model: null,
    productUrl: null,
    retiredAt: null,
    createdAt: 1
  }
]

const renderDialog = (
  items: MediaDetailsDialogItem[],
  props: Partial<{
    initialId: string
    settings: GallerySettingsEntity | null
  }> = {}
) => {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <MediaDetailsDialog
      items={items}
      initialId={props.initialId ?? items[0].id}
      settings={props.settings === undefined ? settings() : props.settings}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
  return { onClose, onSaved }
}

describe('MediaDetailsDialog', () => {
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    vi.clearAllMocks()
    getGalleryGearsMock.mockResolvedValue(gears)
    updateMediaDetailsMock.mockImplementation(
      async (id, fields) =>
        ({
          id,
          description: (fields.description as string | null | undefined) ?? null
        }) as unknown as Awaited<ReturnType<typeof updateMediaDetails>>
    )
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  it('labels the dialog and shows the position with prev/next', () => {
    renderDialog([makeItem('a'), makeItem('b')])

    expect(
      screen.getByRole('dialog', { name: 'Media details' })
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous item' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next item' }))

    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next item' })).toBeDisabled()
  })

  it('hands focus to the other nav button when one becomes disabled', () => {
    renderDialog([makeItem('a'), makeItem('b')])
    const previous = screen.getByRole('button', { name: 'Previous item' })
    const next = screen.getByRole('button', { name: 'Next item' })

    next.focus()
    fireEvent.click(next)
    expect(next).toBeDisabled()
    expect(previous).toHaveFocus()

    fireEvent.click(previous)
    expect(previous).toBeDisabled()
    expect(next).toHaveFocus()
  })

  it('switches items from the thumbnail strip and marks videos', () => {
    renderDialog([
      makeItem('a'),
      makeItem('b', { mediaType: 'video/mp4', posterUrl: 'https://x/p.jpg' })
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Item 2' }))

    expect(
      screen.getByRole('dialog', { name: 'Video details' })
    ).toBeInTheDocument()
    expect(screen.getByText('Cover and description frame')).toBeInTheDocument()
    expect(document.querySelector('video[controls]')).toBeInTheDocument()
  })

  it('sends only the changed fields when saving', async () => {
    const { onSaved, onClose } = renderDialog([makeItem('a'), makeItem('b')])

    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'A heron at dawn' }
    })
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Grey heron' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledTimes(1)
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
      description: 'A heron at dawn',
      subject_name: 'Grey heron'
    })
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', description: 'A heron at dawn' })
    ])
  })

  it('does not call the API when nothing changed', async () => {
    const { onSaved, onClose } = renderDialog([makeItem('a')])

    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('applies the all-items sections to every item', async () => {
    const { onClose } = renderDialog([makeItem('a'), makeItem('b')])

    fireEvent.click(screen.getByLabelText('Show in my gallery'))
    fireEvent.click(screen.getByLabelText('Show all 2 items in my gallery'))
    fireEvent.change(screen.getByLabelText('Place name'), {
      target: { value: 'Marsh' }
    })
    fireEvent.click(screen.getByLabelText('Use this place for all 2 items'))
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledTimes(2)
    for (const id of ['a', 'b']) {
      expect(updateMediaDetailsMock).toHaveBeenCalledWith(id, {
        in_gallery: true,
        place_name: 'Marsh'
      })
    }
  })

  it('applies a gear choice to all items when asked', async () => {
    const { onClose } = renderDialog([makeItem('a'), makeItem('b')])
    await screen.findByRole('option', { name: 'Nikon Z9' })

    fireEvent.change(screen.getByLabelText('Camera'), {
      target: { value: 'cam-1' }
    })
    fireEvent.click(screen.getByLabelText('Use this gear for all 2 items'))
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
      camera_gear_id: 'cam-1'
    })
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('b', {
      camera_gear_id: 'cam-1'
    })
  })

  it('keeps the composer alt text when only non-description fields change', async () => {
    updateMediaDetailsMock.mockResolvedValue({
      id: 'a',
      description: null
    } as unknown as Awaited<ReturnType<typeof updateMediaDetails>>)
    const { onSaved } = renderDialog([
      makeItem('a', { description: 'A heron' })
    ])
    await screen.findByRole('option', { name: 'Nikon Z9' })

    fireEvent.change(screen.getByLabelText('Camera'), {
      target: { value: 'cam-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
      camera_gear_id: 'cam-1'
    })
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', description: 'A heron' })
    ])
  })

  it('lists only active gear of the matching kind', async () => {
    renderDialog([makeItem('a')])
    await screen.findByRole('option', { name: 'Nikon Z9' })

    expect(
      screen.queryByRole('option', { name: 'Retired body' })
    ).not.toBeInTheDocument()
    const camera = screen.getByLabelText('Camera')
    expect(camera).not.toHaveTextContent('400mm f/2.8')
    expect(screen.getByLabelText('Lens')).toHaveTextContent('400mm f/2.8')
  })

  it('adds new gear inline and selects it', async () => {
    createGalleryGearMock.mockResolvedValue({
      ...gears[0],
      id: 'cam-new',
      name: 'Sony A7'
    })
    renderDialog([makeItem('a')])
    await screen.findByRole('option', { name: 'Nikon Z9' })

    fireEvent.change(screen.getByLabelText('Camera'), {
      target: { value: '__add_new_gear__' }
    })
    fireEvent.change(screen.getByLabelText('New camera name'), {
      target: { value: 'Sony A7' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(createGalleryGearMock).toHaveBeenCalledWith({
        kind: 'camera',
        name: 'Sony A7'
      })
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Camera')).toHaveValue('cam-new')
    )
  })

  it('regenerates the description from the alt text service', async () => {
    describeMediaMock.mockResolvedValue('A grey heron wading in a marsh')
    renderDialog([makeItem('a')])

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Description (alt text)')).toHaveValue(
        'A grey heron wading in a marsh'
      )
    )
    expect(describeMediaMock).toHaveBeenCalledWith('a')
    expect(screen.getByText('30/1500')).toBeInTheDocument()
  })

  it('shows the error when regenerating fails', async () => {
    describeMediaMock.mockRejectedValue(new Error('Alt text is unavailable'))
    renderDialog([makeItem('a')])

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Alt text is unavailable'
    )
  })

  it('hides Regenerate when alt text is not configured', () => {
    renderDialog([makeItem('a')], {
      settings: settings({ altTextAvailable: false })
    })

    expect(
      screen.queryByRole('button', { name: 'Regenerate' })
    ).not.toBeInTheDocument()
  })

  it('reports a decorative item without sending a description', async () => {
    const { onSaved, onClose } = renderDialog([makeItem('a')])

    fireEvent.click(
      screen.getByLabelText('Post without a description (decorative image)')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith([
      { id: 'a', description: '', decorative: true }
    ])
  })

  it('keeps the dialog open and reports a failed save', async () => {
    updateMediaDetailsMock.mockRejectedValue(new Error('Unknown camera gear'))
    const { onClose } = renderDialog([makeItem('a')])

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Heron' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unknown camera gear'
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('exposes the precision control as a radiogroup', () => {
    renderDialog([makeItem('a')])

    const group = screen.getByRole('radiogroup', { name: 'Place precision' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Hidden' })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: 'Exact' }))

    expect(screen.getByRole('radio', { name: 'Exact' })).toBeChecked()
  })

  it('shows exposure chips and the from-file badge', () => {
    renderDialog([
      makeItem('a', {
        details: {
          ...emptyDetails,
          takenAt: '2026-05-01T06:30:00.000Z',
          exposure: {
            focalLengthMm: 400,
            aperture: 2.8,
            exposureTime: '1/2000',
            iso: 800
          },
          place: {
            name: null,
            latitude: 1,
            longitude: 2,
            precision: null
          }
        }
      })
    ])

    expect(screen.getByText('400 mm')).toBeInTheDocument()
    expect(screen.getByText('f/2.8')).toBeInTheDocument()
    expect(screen.getByText('1/2000 s')).toBeInTheDocument()
    expect(screen.getByText('ISO 800')).toBeInTheDocument()
    expect(screen.getByText('From file')).toBeInTheDocument()
    expect(screen.getByText(/May 1, 2026/)).toBeInTheDocument()
  })

  it('hides the all-items controls for a single item', () => {
    renderDialog([makeItem('a')])

    expect(screen.queryByText(/for all 1 items/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Show all 1 items/)).not.toBeInTheDocument()
  })

  it('handles items growing and shrinking while open', async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    const view = (items: MediaDetailsDialogItem[]) => (
      <MediaDetailsDialog
        items={items}
        initialId="a"
        settings={settings()}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
    const { rerender } = render(view([makeItem('a')]))

    rerender(view([makeItem('a'), makeItem('b')]))
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next item' }))
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Heron' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('b', {
      subject_name: 'Heron'
    })

    // The selected item disappears: the index is clamped, nothing throws.
    rerender(view([makeItem('a')]))
    expect(screen.getByText('1 of 1')).toBeInTheDocument()
  })

  it('sends only edited fields when details arrive after a draft edit', async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    const view = (item: MediaDetailsDialogItem) => (
      <MediaDetailsDialog
        items={[item]}
        initialId="a"
        settings={settings()}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
    const { rerender } = render(view(makeItem('a', { details: null })))
    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'A heron' }
    })

    rerender(
      view(
        makeItem('a', {
          details: {
            ...emptyDetails,
            inGallery: true,
            camera: { id: 'cam-1', name: 'Nikon Z9' },
            place: {
              name: 'Marsh',
              latitude: null,
              longitude: null,
              precision: 'area'
            }
          }
        })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledTimes(1)
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
      description: 'A heron'
    })
  })

  it('keeps unsaved drafts of the failed and later items after a partial save', async () => {
    updateMediaDetailsMock.mockImplementation(async (id, fields) => {
      if (id === 'b') throw new Error('boom')
      return {
        id,
        description: (fields.description as string | null | undefined) ?? null
      } as unknown as Awaited<ReturnType<typeof updateMediaDetails>>
    })
    const { onClose, onSaved } = renderDialog([
      makeItem('a'),
      makeItem('b'),
      makeItem('c')
    ])
    for (const [position, name] of ['One', 'Two', 'Three'].entries()) {
      if (position > 0) {
        fireEvent.click(screen.getByRole('button', { name: 'Next item' }))
      }
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: name }
      })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })])
    // On item 3 (last viewed) and item 2 the typed values are still there.
    expect(screen.getByLabelText('Name')).toHaveValue('Three')
    fireEvent.click(screen.getByRole('button', { name: 'Previous item' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Two')
  })

  it('moves focus with the selection in the precision radiogroup', () => {
    renderDialog([makeItem('a')])
    const group = screen.getByRole('radiogroup', { name: 'Place precision' })

    fireEvent.keyDown(group, { key: 'ArrowRight' })
    const country = screen.getByRole('radio', { name: 'Country' })
    expect(country).toBeChecked()
    expect(country).toHaveFocus()
    expect(country).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(group, { key: 'Home' })
    expect(screen.getByRole('radio', { name: 'Hidden' })).toHaveFocus()
    fireEvent.keyDown(group, { key: 'End' })
    expect(screen.getByRole('radio', { name: 'Exact' })).toHaveFocus()
  })
})
