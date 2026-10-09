import type {
  GalleryAlbumCardEntity,
  GalleryAlbumDetailResponse,
  GalleryAlbumItemsResult,
  GalleryAlbumListResponse,
  GalleryAlbumMediaPage,
  GalleryAlbumViewResponse
} from '@/lib/services/gallery/galleryAlbumEntities'
import type {
  GalleryAlbumSort,
  GalleryAlbumVisibility
} from '@/lib/types/database/galleryAlbums'
import { toIdPathSegment } from '@/lib/utils/urlToId'

import { parseApiError } from './http'

// The owner's album routes. Every call is for the signed-in owner; a missing
// album and somebody else's are the same 404. The `getAccount…` calls at the
// end read any account's public albums, as the signed-in or logged-out viewer.

const ALBUMS_URL = '/api/v1/gallery/albums'

const albumUrl = (id: string) => `${ALBUMS_URL}/${encodeURIComponent(id)}`

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export interface CreateGalleryAlbumInput {
  title: string
  description?: string | null
  visibility?: GalleryAlbumVisibility
  sortOrder?: GalleryAlbumSort
  // The owner's own gallery media to start with, at most 100.
  mediaIds?: string[]
}

// Presence semantics, as the PATCH route: an omitted key is left alone, and
// `null` clears the description or the explicit cover.
export interface UpdateGalleryAlbumInput {
  title?: string
  description?: string | null
  visibility?: GalleryAlbumVisibility
  sortOrder?: GalleryAlbumSort
  coverMediaId?: string | null
}

export interface GetGalleryAlbumItemsOptions {
  maxId?: string
  limit?: number
  sort?: GalleryAlbumSort
  /** A species key from the album's chips. */
  subject?: string
}

/** The most media ids one add or remove request carries. */
export const GALLERY_ALBUM_ITEMS_BATCH = 100

export const getGalleryAlbums = async (): Promise<GalleryAlbumListResponse> => {
  const response = await fetch(ALBUMS_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load albums.'))
  }
  return (await response.json()) as GalleryAlbumListResponse
}

export const getGalleryAlbum = async (
  id: string,
  options: Pick<GetGalleryAlbumItemsOptions, 'limit' | 'sort'> = {}
): Promise<GalleryAlbumDetailResponse> => {
  const query = new URLSearchParams()
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.sort) query.set('sort', options.sort)
  const search = query.toString()
  const response = await fetch(`${albumUrl(id)}${search ? `?${search}` : ''}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load the album.'))
  }
  return (await response.json()) as GalleryAlbumDetailResponse
}

export const getGalleryAlbumItems = async (
  id: string,
  options: GetGalleryAlbumItemsOptions = {}
): Promise<GalleryAlbumMediaPage> => {
  const query = new URLSearchParams()
  if (options.maxId) query.set('max_id', options.maxId)
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.sort) query.set('sort', options.sort)
  if (options.subject) query.set('subject', options.subject)
  const search = query.toString()
  const response = await fetch(
    `${albumUrl(id)}/items${search ? `?${search}` : ''}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load photos.'))
  }
  return (await response.json()) as GalleryAlbumMediaPage
}

export const createGalleryAlbum = async (
  input: CreateGalleryAlbumInput
): Promise<GalleryAlbumItemsResult> => {
  const response = await fetch(ALBUMS_URL, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      visibility: input.visibility,
      sort_order: input.sortOrder,
      media_ids:
        input.mediaIds && input.mediaIds.length > 0 ? input.mediaIds : undefined
    })
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to create album.'))
  }
  return (await response.json()) as GalleryAlbumItemsResult
}

export const updateGalleryAlbum = async (
  id: string,
  patch: UpdateGalleryAlbumInput
): Promise<GalleryAlbumCardEntity> => {
  const response = await fetch(albumUrl(id), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      title: patch.title,
      description: patch.description,
      visibility: patch.visibility,
      sort_order: patch.sortOrder,
      cover_media_id: patch.coverMediaId
    })
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to save the album.'))
  }
  return ((await response.json()) as { album: GalleryAlbumCardEntity }).album
}

export const deleteGalleryAlbum = async (id: string): Promise<void> => {
  const response = await fetch(albumUrl(id), { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to delete album.'))
  }
}

const batches = <T>(items: T[]): T[][] => {
  const result: T[][] = []
  for (
    let start = 0;
    start < items.length;
    start += GALLERY_ALBUM_ITEMS_BATCH
  ) {
    result.push(items.slice(start, start + GALLERY_ALBUM_ITEMS_BATCH))
  }
  return result
}

/**
 * Adds photos to an album, in requests of at most 100 ids, and merges what
 * each answered. Stops at the first failure: the batches already added stay.
 */
export const addGalleryAlbumItems = async (
  id: string,
  mediaIds: string[]
): Promise<GalleryAlbumItemsResult> => {
  let result: GalleryAlbumItemsResult | null = null
  for (const batch of batches(mediaIds)) {
    const response = await fetch(`${albumUrl(id)}/items`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ media_ids: batch })
    })
    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to add photos.'))
    }
    const next = (await response.json()) as GalleryAlbumItemsResult
    result = result
      ? {
          album: next.album,
          added: [...result.added, ...next.added],
          existing: [...result.existing, ...next.existing],
          skipped: [...result.skipped, ...next.skipped]
        }
      : next
  }
  if (!result) throw new Error('Choose at least one photo.')
  return result
}

/** Removes photos from an album, in requests of at most 100 ids. */
export const removeGalleryAlbumItems = async (
  id: string,
  mediaIds: string[]
): Promise<{ removed: string[]; album: GalleryAlbumCardEntity }> => {
  let removed: string[] = []
  let album: GalleryAlbumCardEntity | null = null
  for (const batch of batches(mediaIds)) {
    const response = await fetch(`${albumUrl(id)}/items`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ media_ids: batch })
    })
    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to remove photos.'))
    }
    const next = (await response.json()) as {
      removed: string[]
      album: GalleryAlbumCardEntity
    }
    removed = [...removed, ...next.removed]
    album = next.album
  }
  if (!album) throw new Error('Choose at least one photo.')
  return { removed, album }
}

const accountAlbumsUrl = (actorId: string) =>
  `/api/v1/accounts/${toIdPathSegment(actorId)}/gallery/albums`

/**
 * An account's albums as the viewer may open them: for anyone but the owner,
 * the public albums with something they can see, counted from what they can
 * see.
 */
export const getAccountGalleryAlbums = async (
  actorId: string
): Promise<GalleryAlbumListResponse> => {
  const response = await fetch(accountAlbumsUrl(actorId), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load albums.'))
  }
  return (await response.json()) as GalleryAlbumListResponse
}

/**
 * A page of one account's album, with its facts and species from the photos the
 * viewer can see. Rejects when the album is private, missing, or has nothing
 * this viewer can see (one and the same 404).
 */
export const getAccountGalleryAlbum = async (
  actorId: string,
  albumId: string,
  options: GetGalleryAlbumItemsOptions = {}
): Promise<GalleryAlbumViewResponse> => {
  const query = new URLSearchParams()
  if (options.maxId) query.set('max_id', options.maxId)
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.sort) query.set('sort', options.sort)
  if (options.subject) query.set('subject', options.subject)
  const search = query.toString()
  const response = await fetch(
    `${accountAlbumsUrl(actorId)}/${encodeURIComponent(albumId)}${
      search ? `?${search}` : ''
    }`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load the album.'))
  }
  return (await response.json()) as GalleryAlbumViewResponse
}
