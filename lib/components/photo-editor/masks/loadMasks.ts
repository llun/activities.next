import { getMediaEditMaskBlob } from '@/lib/client'
import type { Recipe } from '@/lib/services/medias/edit/recipe'

import { type MaskRaster, type MaskRasters } from './maskRaster'
import { decodeMaskPng } from './pngCodec'

export interface LoadedMasks {
  /** The pixels of every mask that could be read. */
  rasters: MaskRasters
  /** The masks whose saved image is missing or unreadable. */
  failed: string[]
}

/**
 * Fetches and decodes the saved mask PNGs (`GET /edit` lists them) for the
 * masks of a recipe that have pixels of their own. A mask that cannot be read
 * is reported in `failed` instead of failing the rest, so one lost file never
 * locks the photo (the editor drops that mask and says so). Only an abort
 * rejects.
 */
export const loadMaskRasters = async (
  recipe: Recipe | null,
  files: ReadonlyArray<{ id: string; url: string }>,
  signal?: AbortSignal
): Promise<LoadedMasks> => {
  if (!recipe) return { rasters: {}, failed: [] }
  const wanted = recipe.masks.filter((mask) => mask.kind !== 'background')
  const rasters: Record<string, MaskRaster> = {}
  const failed: string[] = []
  await Promise.all(
    wanted.map(async (mask) => {
      try {
        const file = files.find((item) => item.id === mask.id)
        if (!file) throw new Error('A saved mask is missing')
        rasters[mask.id] = await decodeMaskPng(
          await getMediaEditMaskBlob(file.url, signal)
        )
      } catch (error) {
        if (signal?.aborted) throw error
        failed.push(mask.id)
      }
    })
  )
  return { rasters, failed }
}
