import { pluralize } from '@/lib/components/gallery/galleryCategories'
import type {
  GalleryAlbumSuggestionEntity,
  GalleryAlbumSuggestionKind
} from '@/lib/services/gallery/galleryAlbumSuggestionEntities'

import { formatAlbumDateRange } from './galleryAlbumsUi'

export const SUGGESTION_KIND_LABELS: Record<
  GalleryAlbumSuggestionKind,
  string
> = {
  trip: 'Trip',
  species: 'Species',
  activity_day: 'Activity day'
}

/**
 * "Trip · 86 photos · 12 – 19 Sep 2026 · 4 places · 11 species": the kind, the
 * count, the dates, and what a visitor would see of the places and species.
 */
export const getSuggestionMeta = (
  suggestion: GalleryAlbumSuggestionEntity
): string =>
  [
    SUGGESTION_KIND_LABELS[suggestion.kind],
    pluralize(suggestion.photoCount, 'photo'),
    formatAlbumDateRange(suggestion.firstAt, suggestion.lastAt),
    suggestion.kind === 'trip' && suggestion.placeCount > 0
      ? pluralize(suggestion.placeCount, 'place')
      : '',
    suggestion.kind === 'trip' && suggestion.speciesCount > 0
      ? pluralize(suggestion.speciesCount, 'species', 'species')
      : '',
    suggestion.kind === 'activity_day' && suggestion.activityCount > 0
      ? suggestion.activityCount === 1
        ? 'matches a recorded activity'
        : `matches ${pluralize(suggestion.activityCount, 'recorded activity', 'recorded activities')}`
      : ''
  ]
    .filter(Boolean)
    .join(' · ')

/** "2 suggested albums" (the chip on the Albums tab). */
export const getSuggestedAlbumsLabel = (count: number): string =>
  pluralize(count, 'suggested album')
