import { render } from '@testing-library/react'
import { vi } from 'vitest'

import {
  addGalleryAlbumItems,
  createGalleryGear,
  describeMedia,
  getGalleryGears,
  getMedia,
  getMediaAlbums,
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

/*
 * Shared fixtures and render helper for the media-details-dialog test files.
 * Each test file declares its own vi.mock('@/lib/client', ...) (mocks are
 * hoisted per file); the vi.mocked handles below resolve to those mocks.
 */
export const describeMediaMock = vi.mocked(describeMedia)
export const updateMediaDetailsMock = vi.mocked(updateMediaDetails)
export const getGalleryGearsMock = vi.mocked(getGalleryGears)
export const createGalleryGearMock = vi.mocked(createGalleryGear)
export const suggestMediaSubjectsMock = vi.mocked(suggestMediaSubjects)
export const retryMediaLookupsMock = vi.mocked(retryMediaLookups)
export const getMediaMock = vi.mocked(getMedia)
export const getMediaAlbumsMock = vi.mocked(getMediaAlbums)
export const addAlbumItemsMock = vi.mocked(addGalleryAlbumItems)

export const emptyDetails: MediaDetailsEntity = {
  subject: null,
  takenAt: null,
  camera: null,
  lens: null,
  exposure: null,
  place: null,
  inGallery: false,
  subjectSuggestions: null
}

export const makeItem = (
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

export const settings = (
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

export const gears = [
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

export const renderDialog = (
  items: MediaDetailsDialogItem[],
  props: Partial<{
    initialId: string
    settings: GallerySettingsEntity | null
    suggestionsPending: Record<string, true>
    ownerId: string
    context: 'composer' | 'gallery'
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
      ownerId={props.ownerId}
      context={props.context}
    />
  )
  return { onClose, onSaved, onDetailsRefreshed }
}

export const SUGGESTIONS: NonNullable<
  MediaDetailsEntity['subjectSuggestions']
> = {
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

export const withSuggestions = (
  suggestions: typeof SUGGESTIONS | null = SUGGESTIONS,
  overrides: Partial<MediaDetailsEntity> = {}
) =>
  makeItem('m1', {
    details: { ...emptyDetails, subjectSuggestions: suggestions, ...overrides }
  })
