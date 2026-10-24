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

/** In Add photos, a suggestion whose photos are at least this share in the album is not offered. */
export const ADD_INTENT_MEMBER_SHARE = 0.8
/** The suggestion's photos not in the album (in its order). */
export const getNonMemberIds = (
  s: GalleryAlbumSuggestionEntity,
  members: ReadonlySet<string>
): string[] => s.mediaIds.filter((id) => !members.has(id))
/** The suggestions worth offering for an existing album. */
export const getAddIntentSuggestions = (
  list: readonly GalleryAlbumSuggestionEntity[],
  members: ReadonlySet<string>
): GalleryAlbumSuggestionEntity[] =>
  list.filter(
    (s) =>
      s.mediaIds.length > 0 &&
      (s.mediaIds.length - getNonMemberIds(s, members).length) /
        s.mediaIds.length <
        ADD_INTENT_MEMBER_SHARE
  )

/**
 * "Trip · 86 photos · 12 – 19 Sep 2026 · 4 places · 11 species": the kind, the
 * count, the dates, and what a visitor would see of the places and species.
 */
export const getSuggestionMeta = (
  suggestion: GalleryAlbumSuggestionEntity,
  notInAlbum?: number
): string =>
  [
    SUGGESTION_KIND_LABELS[suggestion.kind],
    typeof notInAlbum === 'number'
      ? `${notInAlbum.toLocaleString('en-US')} not in this album`
      : pluralize(suggestion.photoCount, 'photo'),
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
