/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  createGalleryGear,
  describeMedia,
  getGalleryGears,
  retryMediaLookups,
  suggestMediaSubjects,
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
  retryMediaLookups: vi.fn(),
  searchGalleryTaxa: vi.fn(),
  suggestMediaSubjects: vi.fn(),
  updateMediaDetails: vi.fn(),
  TaxaSearchUnavailableError: class extends Error {}
}))

const describeMediaMock = vi.mocked(describeMedia)
const updateMediaDetailsMock = vi.mocked(updateMediaDetails)
const getGalleryGearsMock = vi.mocked(getGalleryGears)
const createGalleryGearMock = vi.mocked(createGalleryGear)
const suggestMediaSubjectsMock = vi.mocked(suggestMediaSubjects)
const retryMediaLookupsMock = vi.mocked(retryMediaLookups)

const emptyDetails: MediaDetailsEntity = {
  subject: null,
  takenAt: null,
  camera: null,
  lens: null,
  exposure: null,
  place: null,
  inGallery: false,
  subjectSuggestions: null
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
  subjectSuggestionsAvailable: true,
  subjectModel: 'test-vision-model',
  speciesLookupsAvailable: true,
  placeLookupsAvailable: true,
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
    suggestionsPending: Record<string, true>
  }> = {}
) => {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const onDetailsRefreshed = vi.fn()
  render(
    <MediaDetailsDialog
      items={items}
      initialId={props.initialId ?? items[0].id}
      settings={props.settings === undefined ? settings() : props.settings}
      onClose={onClose}
      onSaved={onSaved}
      onDetailsRefreshed={onDetailsRefreshed}
      suggestionsPending={props.suggestionsPending}
    />
  )
  return { onClose, onSaved, onDetailsRefreshed }
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

  it('keeps the retired gear the media already carries in its picker', async () => {
    renderDialog([
      makeItem('a', {
        details: {
          ...emptyDetails,
          camera: { id: 'cam-old', name: 'Retired body' }
        }
      })
    ])

    expect(
      await screen.findByRole('option', { name: 'Retired body' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Camera')).toHaveValue('cam-old')
    // Other retired gear stays out, and so does the retired body for a media
    // that does not carry it.
    expect(
      screen.getAllByRole('option', { name: 'Retired body' })
    ).toHaveLength(1)
  })

  it('opens the gear page in a new tab so the composer is kept', async () => {
    renderDialog([makeItem('a')])
    await screen.findByRole('option', { name: 'Nikon Z9' })

    const link = screen.getByRole('link', { name: /Manage gear/ })
    expect(link).toHaveAttribute('href', '/gallery/gear')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
    expect(link).toHaveAccessibleName('Manage gear (opens in a new tab)')
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
            precision: null,
            countryCode: null,
            nameSource: null,
            lookupStatus: null
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
              precision: 'area',
              countryCode: null,
              nameSource: null,
              lookupStatus: null
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

const SUGGESTIONS: NonNullable<MediaDetailsEntity['subjectSuggestions']> = {
  model: 'test-vision-model',
  generatedAt: '2026-10-08T10:00:00.000Z',
  checkedAgainst: 'gbif',
  candidates: [
    {
      name: 'Warbling White-eye',
      scientificName: 'Zosterops japonicus',
      category: 'bird',
      confidence: 0.81,
      taxonKey: '5232437',
      rank: 'SPECIES',
      taxonPath: [
        'Animalia',
        'Chordata',
        'Aves',
        'Passeriformes',
        'Zosteropidae'
      ]
    },
    {
      name: 'Swinhoe’s White-eye',
      scientificName: 'Zosterops simplex',
      category: 'bird',
      confidence: 0.12,
      taxonKey: '5232440',
      rank: 'SPECIES',
      taxonPath: ['Animalia', 'Chordata', 'Aves']
    }
  ],
  group: 'bird'
}

const withSuggestions = (
  suggestions: typeof SUGGESTIONS | null = SUGGESTIONS,
  overrides: Partial<MediaDetailsEntity> = {}
) =>
  makeItem('m1', {
    details: { ...emptyDetails, subjectSuggestions: suggestions, ...overrides }
  })

describe('MediaDetailsDialog smart subjects', () => {
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    vi.clearAllMocks()
    getGalleryGearsMock.mockResolvedValue(gears)
    updateMediaDetailsMock.mockImplementation(
      async (id) =>
        ({ id, description: null }) as unknown as Awaited<
          ReturnType<typeof updateMediaDetails>
        >
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

  it('offers the candidates at or above the threshold and the group', () => {
    renderDialog([withSuggestions()])

    expect(
      screen.getByText('Suggested by test-vision-model · checked against GBIF')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Warbling White-eye 81%' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Swinhoe/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Just “Bird”' })
    ).toBeInTheDocument()
  })

  it('does not claim a GBIF check when the suggestions were not checked', () => {
    renderDialog([withSuggestions({ ...SUGGESTIONS, checkedAgainst: null })])

    expect(
      screen.getByText('Suggested by test-vision-model')
    ).toBeInTheDocument()
    expect(screen.queryByText(/checked against GBIF/)).not.toBeInTheDocument()
  })

  it('moves the threshold with the setting', () => {
    renderDialog([withSuggestions()], {
      settings: settings({ subjectConfidenceThreshold: 10 })
    })

    expect(
      screen.getByRole('button', { name: 'Swinhoe’s White-eye 12%' })
    ).toBeInTheDocument()
  })

  it('offers only the group guess when no candidate is confident enough', () => {
    renderDialog([withSuggestions()], {
      settings: settings({ subjectConfidenceThreshold: 90 })
    })

    expect(
      screen.queryByRole('button', { name: /Warbling White-eye/ })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bird?' })).toBeInTheDocument()
  })

  it('fills the draft from a candidate and saves only on Save', async () => {
    const { onSaved } = renderDialog([withSuggestions()])

    const chip = screen.getByRole('button', { name: 'Warbling White-eye 81%' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Name')).toHaveValue('Warbling White-eye')
    expect(screen.getByLabelText('Scientific name')).toHaveValue(
      'Zosterops japonicus'
    )
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            'Zosterops japonicus · Animalia › Chordata › Aves › Passeriformes › Zosteropidae'
      )
    ).toBeInTheDocument()
    expect(updateMediaDetailsMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('m1', {
      subject_name: 'Warbling White-eye',
      subject_scientific_name: 'Zosterops japonicus',
      subject_category: 'bird',
      subject_taxon_key: '5232437'
    })
  })

  it('picks the group alone, with no species or taxon', async () => {
    renderDialog([withSuggestions()])

    fireEvent.click(screen.getByRole('button', { name: 'Just “Bird”' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(updateMediaDetailsMock).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('m1', {
      subject_name: 'Bird',
      subject_category: 'bird'
    })
  })

  it('drops the matched taxon when the scientific name is edited by hand', async () => {
    renderDialog([withSuggestions()])
    fireEvent.click(
      screen.getByRole('button', { name: 'Warbling White-eye 81%' })
    )

    fireEvent.change(screen.getByLabelText('Scientific name'), {
      target: { value: 'Zosterops palpebrosus' }
    })

    expect(screen.queryByText(/Zosteropidae/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(updateMediaDetailsMock).toHaveBeenCalled())
    expect(updateMediaDetailsMock.mock.calls[0][1]).not.toHaveProperty(
      'subject_taxon_key'
    )
  })

  it('keeps the manual inputs under Edit manually', () => {
    renderDialog([withSuggestions()])

    const toggle = screen.getByRole('button', { name: 'Edit manually' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Name')).not.toBeVisible()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Name')).toBeVisible()
  })

  it('shows the manual inputs and no suggestion controls when the server offers neither', () => {
    renderDialog([withSuggestions()], {
      settings: settings({
        subjectSuggestionsAvailable: false,
        speciesLookupsAvailable: false
      })
    })

    expect(screen.getByLabelText('Name')).toBeVisible()
    expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Search subjects/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit manually' })
    ).not.toBeInTheDocument()
  })

  it('hides stored suggestions when the author turned suggestions off', () => {
    renderDialog([withSuggestions()], {
      settings: settings({ subjectSuggestionMode: 'off' })
    })

    expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Suggest subjects' })
    ).not.toBeInTheDocument()
  })

  it('asks for suggestions on request and shares them with the composer', async () => {
    suggestMediaSubjectsMock.mockResolvedValue(SUGGESTIONS)
    const { onDetailsRefreshed } = renderDialog([withSuggestions(null)])

    fireEvent.click(screen.getByRole('button', { name: 'Suggest subjects' }))

    expect(
      await screen.findByRole('button', { name: 'Warbling White-eye 81%' })
    ).toBeInTheDocument()
    expect(suggestMediaSubjectsMock).toHaveBeenCalledWith('m1')
    expect(onDetailsRefreshed).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ subjectSuggestions: SUGGESTIONS })
    )
  })

  it('reports a failed suggestion request', async () => {
    suggestMediaSubjectsMock.mockRejectedValue(
      new Error('Subject suggestions are not configured')
    )
    renderDialog([withSuggestions(null)])

    fireEvent.click(screen.getByRole('button', { name: 'Suggest subjects' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Subject suggestions are not configured'
    )
  })

  it('says it is reading while the composer is still asking', () => {
    renderDialog([withSuggestions(null)], {
      suggestionsPending: { m1: true }
    })

    expect(screen.getByRole('status')).toHaveTextContent('Reading details…')
    expect(
      screen.queryByRole('button', { name: 'Suggest subjects' })
    ).not.toBeInTheDocument()
  })

  it('opens the species picker from Search subjects', () => {
    renderDialog([withSuggestions()])

    fireEvent.click(screen.getByRole('button', { name: /Search subjects/ }))

    expect(
      screen.getByRole('dialog', { name: 'What’s in this photo?' })
    ).toBeInTheDocument()
  })

  it('applies the picker’s choice to the draft', async () => {
    renderDialog([withSuggestions()])
    fireEvent.click(screen.getByRole('button', { name: /Search subjects/ }))

    fireEvent.click(
      screen.getByRole('button', { name: 'Use Warbling White-eye' })
    )

    expect(
      screen.queryByRole('dialog', { name: 'What’s in this photo?' })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Warbling White-eye')
  })

  it('applies the picker’s choice to every item when asked', async () => {
    renderDialog([withSuggestions(), makeItem('m2')])
    fireEvent.click(screen.getByRole('button', { name: /Search subjects/ }))

    fireEvent.click(screen.getByRole('switch', { name: /every shot/ }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Use Warbling White-eye' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(updateMediaDetailsMock).toHaveBeenCalledTimes(2))
    expect(updateMediaDetailsMock).toHaveBeenCalledWith(
      'm2',
      expect.objectContaining({ subject_name: 'Warbling White-eye' })
    )
  })

  describe('lookup status', () => {
    const subject = (
      overrides: Partial<NonNullable<MediaDetailsEntity['subject']>>
    ): MediaDetailsEntity => ({
      ...emptyDetails,
      subject: {
        name: 'Bengal Tiger',
        scientificName: 'Panthera tigris',
        category: 'mammal',
        taxonKey: '5219416',
        taxonPath: ['Animalia'],
        iucnCategory: null,
        threatStatus: 'unchecked',
        lookupStatus: null,
        ...overrides
      }
    })

    it('shows the IUCN status and that a threatened place is hidden', () => {
      renderDialog([
        makeItem('m1', {
          details: subject({
            iucnCategory: 'EN',
            threatStatus: 'threatened',
            lookupStatus: 'resolved'
          })
        })
      ])

      expect(
        screen.getByText(/Endangered \(EN\) · IUCN Red List status via GBIF/)
      ).toBeInTheDocument()
      expect(
        screen.getByText(/the place is hidden from other people/)
      ).toBeInTheDocument()
    })

    it('does not say the place is hidden when the author turned that off', () => {
      renderDialog(
        [
          makeItem('m1', {
            details: subject({
              iucnCategory: 'EN',
              threatStatus: 'threatened',
              lookupStatus: 'resolved'
            })
          })
        ],
        { settings: settings({ hideThreatenedPlaces: false }) }
      )

      expect(screen.queryByText(/place is hidden/)).not.toBeInTheDocument()
    })

    it('offers Retry when the check failed and shows the refreshed status', async () => {
      retryMediaLookupsMock.mockResolvedValue(
        subject({ lookupStatus: 'pending' })
      )
      const { onDetailsRefreshed } = renderDialog([
        makeItem('m1', { details: subject({ lookupStatus: 'failed' }) })
      ])
      expect(screen.getByText(/Couldn’t check IUCN status/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      expect(
        await screen.findByText('Checking IUCN status…')
      ).toBeInTheDocument()
      expect(retryMediaLookupsMock).toHaveBeenCalledWith('m1')
      expect(onDetailsRefreshed).toHaveBeenCalled()
    })

    it('hides the status once the draft no longer holds the saved subject', () => {
      renderDialog([
        makeItem('m1', {
          details: subject({ lookupStatus: 'failed' })
        })
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Edit manually' }))
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Tiger' }
      })

      expect(
        screen.queryByText(/Couldn’t check IUCN status/)
      ).not.toBeInTheDocument()
    })

    it('reports a failed retry', async () => {
      retryMediaLookupsMock.mockRejectedValue(new Error('Too many requests'))
      renderDialog([
        makeItem('m1', { details: subject({ lookupStatus: 'failed' }) })
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many requests'
      )
    })
  })

  describe('place lookup', () => {
    const place = (
      overrides: Partial<NonNullable<MediaDetailsEntity['place']>>
    ): MediaDetailsEntity => ({
      ...emptyDetails,
      place: {
        name: 'Khao Yai National Park, Thailand',
        latitude: 14.4,
        longitude: 101.4,
        precision: 'area',
        countryCode: 'TH',
        nameSource: 'geocoder',
        lookupStatus: 'resolved',
        ...overrides
      }
    })

    it('credits OpenStreetMap beside a place from the file', () => {
      renderDialog([makeItem('m1', { details: place({}) })])

      expect(
        screen.getByText('Place names © OpenStreetMap contributors')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Place name')).toHaveValue(
        'Khao Yai National Park, Thailand'
      )
      expect(screen.getByText('From file')).toBeInTheDocument()
    })

    it('leaves the credit out when place lookups are off', () => {
      renderDialog([makeItem('m1', { details: place({}) })], {
        settings: settings({ placeLookupsAvailable: false })
      })

      expect(screen.queryByText(/OpenStreetMap/)).not.toBeInTheDocument()
    })

    it('offers Retry when the name lookup failed', async () => {
      retryMediaLookupsMock.mockResolvedValue(
        place({ lookupStatus: 'resolved' })
      )
      renderDialog([
        makeItem('m1', {
          details: place({
            name: null,
            nameSource: null,
            lookupStatus: 'failed'
          })
        })
      ])
      expect(
        screen.getByText(/Couldn’t look up the place name/)
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() =>
        expect(retryMediaLookupsMock).toHaveBeenCalledWith('m1')
      )
      expect(
        await screen.findByDisplayValue('Khao Yai National Park, Thailand')
      ).toBeInTheDocument()
    })

    it('says the name is being looked up', () => {
      renderDialog([
        makeItem('m1', {
          details: place({
            name: null,
            nameSource: null,
            lookupStatus: 'pending'
          })
        })
      ])

      expect(screen.getByRole('status')).toHaveTextContent(
        'Looking up the place name…'
      )
    })
  })
})
