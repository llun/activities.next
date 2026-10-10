import type { Recipe } from '@/lib/services/medias/edit/recipe'

import { type MaskRaster, type MaskRasters } from './maskRaster'
import { decodeMaskPng } from './pngCodec'

/**
 * Fetches and decodes the saved mask PNGs (`GET /edit` lists them) for the
 * masks of a recipe that have pixels of their own. Throws when one cannot be
 * read, so the editor never opens with a mask silently missing.
 */
export const loadMaskRasters = async (
  recipe: Recipe | null,
  files: ReadonlyArray<{ id: string; url: string }>,
  signal?: AbortSignal
): Promise<MaskRasters> => {
  if (!recipe) return {}
  const wanted = recipe.masks.filter((mask) => mask.kind !== 'background')
  const entries = await Promise.all(
    wanted.map(async (mask): Promise<[string, MaskRaster]> => {
      const file = files.find((item) => item.id === mask.id)
      if (!file) throw new Error('A saved mask is missing')
      const response = await fetch(file.url, {
        credentials: 'include',
        signal
      })
      if (!response.ok) throw new Error('Failed to load a mask.')
      return [mask.id, await decodeMaskPng(await response.blob())]
    })
  )
  return Object.fromEntries(entries)
}
