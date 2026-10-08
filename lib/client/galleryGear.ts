import type {
  GalleryGearEntity,
  GalleryGearWithUsageEntity
} from '@/lib/services/gallery/galleryEntities'

import { parseApiError } from './http'

// Presence semantics, as the PATCH route: an omitted key is left alone and
// `null` clears brand, model or product page. `kind` cannot be changed.
export interface UpdateGalleryGearInput {
  name?: string
  brand?: string | null
  model?: string | null
  productUrl?: string | null
}

const gearPath = (id: string) =>
  `/api/v1/gallery/gears/${encodeURIComponent(id)}`

/** The actor's gear with photo counts and first and last use. */
export const getGalleryGearsWithUsage = async (): Promise<
  GalleryGearWithUsageEntity[]
> => {
  const response = await fetch('/api/v1/gallery/gears?include=usage', {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load gear.'))
  }
  const data = (await response.json()) as {
    gears: GalleryGearWithUsageEntity[]
  }
  return data.gears
}

export const getGalleryGear = async (
  id: string
): Promise<GalleryGearWithUsageEntity> => {
  const response = await fetch(gearPath(id), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load gear.'))
  }
  const data = (await response.json()) as { gear: GalleryGearWithUsageEntity }
  return data.gear
}

export const updateGalleryGear = async (
  id: string,
  patch: UpdateGalleryGearInput
): Promise<GalleryGearEntity> => {
  const response = await fetch(gearPath(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to save gear.'))
  }
  const data = (await response.json()) as { gear: GalleryGearEntity }
  return data.gear
}

export const deleteGalleryGear = async (id: string): Promise<void> => {
  const response = await fetch(gearPath(id), { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to delete gear.'))
  }
}

export const setGalleryGearRetired = async (
  id: string,
  retired: boolean
): Promise<GalleryGearEntity> => {
  const response = await fetch(`${gearPath(id)}/retire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ retired })
  })
  if (!response.ok) {
    throw new Error(
      await parseApiError(
        response,
        retired ? 'Failed to retire gear.' : 'Failed to unretire gear.'
      )
    )
  }
  const data = (await response.json()) as { gear: GalleryGearEntity }
  return data.gear
}
