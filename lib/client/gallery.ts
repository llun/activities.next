import type {
  GalleryGearEntity,
  GallerySettingsEntity,
  MediaPublicDetails
} from '@/lib/services/gallery/galleryEntities'
import type {
  GalleryGearKind,
  GallerySettings
} from '@/lib/types/database/gallery'

import { parseApiError } from './http'

export interface CreateGalleryGearInput {
  kind: GalleryGearKind
  name: string
  brand?: string | null
  model?: string | null
  productUrl?: string | null
}

export type UpdateGallerySettingsInput = Partial<GallerySettings>

/** The actor's camera and lens gear, oldest first. */
export const getGalleryGears = async (): Promise<GalleryGearEntity[]> => {
  const response = await fetch('/api/v1/gallery/gears', {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load gear.'))
  }
  const data = (await response.json()) as { gears: GalleryGearEntity[] }
  return data.gears
}

export const createGalleryGear = async (
  input: CreateGalleryGearInput
): Promise<GalleryGearEntity> => {
  const response = await fetch('/api/v1/gallery/gears', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to save gear.'))
  }
  const data = (await response.json()) as { gear: GalleryGearEntity }
  return data.gear
}

export const getGallerySettings = async (): Promise<GallerySettingsEntity> => {
  const response = await fetch('/api/v1/gallery/settings', {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Failed to load gallery settings.')
    )
  }
  return response.json()
}

/** Sends only the keys given; an omitted setting is left alone. */
export const updateGallerySettings = async (
  patch: UpdateGallerySettingsInput
): Promise<GallerySettingsEntity> => {
  const response = await fetch('/api/v1/gallery/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Failed to save gallery settings.')
    )
  }
  return response.json()
}

/**
 * The public-safe details of a photo (subject, taken-at, gear, place), for the
 * viewer. Resolves to null when the media is not attached to a post the viewer
 * may see; rejects on any other failure.
 */
export const getMediaPublicDetails = async (
  mediaId: string
): Promise<MediaPublicDetails | null> => {
  const response = await fetch(
    `/api/v1/gallery/media/${encodeURIComponent(mediaId)}/details`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  )
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Failed to load media details.')
    )
  }
  return response.json()
}
