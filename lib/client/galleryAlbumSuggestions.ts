import type {
  GalleryAlbumSuggestionMediaResponse,
  GalleryAlbumSuggestionsResponse
} from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import { MAX_GALLERY_ALBUM_REQUEST_IDS } from '@/lib/types/database/galleryAlbums'

import { parseApiError } from './http'

// The owner's album suggestions. Computed by the server on every call and never
// stored, so a result is only as fresh as the request.

const SUGGESTIONS_URL = '/api/v1/gallery/albums/suggestions'

export interface GetGalleryAlbumSuggestionsOptions {
  /** The viewer's named IANA zone: which local day an activity is on. */
  timeZone?: string
}

export const getGalleryAlbumSuggestions = async (
  options: GetGalleryAlbumSuggestionsOptions = {}
): Promise<GalleryAlbumSuggestionsResponse> => {
  const query = new URLSearchParams()
  if (options.timeZone) query.set('time_zone', options.timeZone)
  const search = query.toString()
  const response = await fetch(
    `${SUGGESTIONS_URL}${search ? `?${search}` : ''}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Failed to load suggestions.')
    )
  }
  return (await response.json()) as GalleryAlbumSuggestionsResponse
}

/**
 * The owner's photos behind at most 100 media ids, in the order asked; one
 * request, so a caller pages a longer list itself.
 */
export const getGalleryAlbumSuggestionMedia = async (
  mediaIds: string[]
): Promise<GalleryAlbumSuggestionMediaResponse> => {
  if (mediaIds.length === 0) return { items: [] }
  if (mediaIds.length > MAX_GALLERY_ALBUM_REQUEST_IDS) {
    throw new Error(
      `Ask for at most ${MAX_GALLERY_ALBUM_REQUEST_IDS} photos at a time.`
    )
  }
  const query = new URLSearchParams({ media_ids: mediaIds.join(',') })
  const response = await fetch(`${SUGGESTIONS_URL}/media?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load photos.'))
  }
  return (await response.json()) as GalleryAlbumSuggestionMediaResponse
}
