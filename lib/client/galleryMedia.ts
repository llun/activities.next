import type {
  GalleryLifeListResponse,
  GalleryMapResponse,
  GalleryMediaPage,
  GallerySubjectsResponse
} from '@/lib/services/gallery/galleryEntities'
import type {
  GalleryShow,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'
import { toIdPathSegment } from '@/lib/utils/urlToId'

import { parseApiError } from './http'

export interface GetGalleryMediaOptions {
  maxId?: string
  limit?: number
  /** A `toSubjectKey` key, sent verbatim. */
  subject?: string
  category?: MediaSubjectCategory
  /** Owner only; anyone else gets a 422. */
  gearId?: string
  /**
   * Owner only: `all` posted or added media, just the `hidden` ones, or the
   * ones `not_posted` yet. Without it the server answers with the gallery
   * (`in_gallery`); for anyone but the owner it is ignored.
   */
  show?: GalleryShow
}

const galleryUrl = (
  actorId: string,
  segment: string,
  query?: URLSearchParams
) => {
  const search = query?.toString()
  return `/api/v1/accounts/${toIdPathSegment(actorId)}/gallery/${segment}${
    search ? `?${search}` : ''
  }`
}

const readGallery = async <T>(
  url: string,
  fallbackMessage: string
): Promise<T> => {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, fallbackMessage))
  }
  return (await response.json()) as T
}

// The life list and the map answer 404 when the owner has not made them
// public, which is an ordinary "nothing to show", not a failure.
const readGalleryOrNull = async <T>(
  url: string,
  fallbackMessage: string
): Promise<T | null> => {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(await parseApiError(response, fallbackMessage))
  }
  return (await response.json()) as T
}

/** A page of the account's gallery photos, newest upload first. */
export const getGalleryMedia = async (
  actorId: string,
  { maxId, limit, subject, category, gearId, show }: GetGalleryMediaOptions = {}
): Promise<GalleryMediaPage> => {
  const query = new URLSearchParams()
  if (maxId !== undefined) query.set('max_id', maxId)
  if (limit !== undefined) query.set('limit', String(limit))
  if (subject !== undefined) query.set('subject', subject)
  if (category !== undefined) query.set('category', category)
  if (gearId !== undefined) query.set('gear_id', gearId)
  if (show !== undefined) query.set('show', show)
  return readGallery<GalleryMediaPage>(
    galleryUrl(actorId, 'media', query),
    'Failed to load photos.'
  )
}

export const getGallerySubjects = async (
  actorId: string
): Promise<GallerySubjectsResponse> =>
  readGallery<GallerySubjectsResponse>(
    galleryUrl(actorId, 'subjects'),
    'Failed to load subjects.'
  )

/** The account's life list, or null when it is not public. */
export const getGalleryLifeList = async (
  actorId: string
): Promise<GalleryLifeListResponse | null> =>
  readGalleryOrNull<GalleryLifeListResponse>(
    galleryUrl(actorId, 'life-list'),
    'Failed to load the life list.'
  )

/**
 * The account's map points, or null when the map is not public. The owner's
 * `previewPublic` asks for exactly what a logged-out visitor would get.
 */
export const getGalleryMap = async (
  actorId: string,
  { previewPublic }: { previewPublic?: boolean } = {}
): Promise<GalleryMapResponse | null> => {
  const query = new URLSearchParams()
  if (previewPublic) query.set('preview', 'public')
  return readGalleryOrNull<GalleryMapResponse>(
    galleryUrl(actorId, 'map', query),
    'Failed to load the map.'
  )
}

/**
 * Keeps uploaded media in the owner's gallery without a post (`media_ids` are
 * the ids `uploadAttachment` answered with). Resolves to the ids that were
 * added; one that is not the caller's, is already in a post, or is gone is left
 * out. Rejects when none could be added.
 */
export const addMediaToGallery = async (
  mediaIds: string[]
): Promise<string[]> => {
  const response = await fetch('/api/v1/gallery/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_ids: mediaIds })
  })
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Failed to add to your gallery.')
    )
  }
  const data = (await response.json()) as { media_ids: string[] }
  return data.media_ids
}
