import type { Recipe } from '@/lib/services/medias/edit/recipe'

import { getRasters } from './maskRaster'
import { encodeMaskPng } from './pngCodec'

/**
 * The `mask_<id>` PNG parts of a save: one for each mask with pixels of its
 * own that is new or whose pixels differ from the ones the editor opened with
 * (a mask left alone already has its file on the server). Background masks
 * have no pixels.
 */
export const buildMaskParts = async (
  present: Recipe,
  baseline: Recipe
): Promise<Record<string, Blob>> => {
  const now = getRasters(present)
  const before = getRasters(baseline)
  const parts: Record<string, Blob> = {}
  for (const mask of present.masks) {
    if (mask.kind === 'background') continue
    const raster = now[mask.id]
    if (!raster || raster === before[mask.id]) continue
    parts[mask.id] = await encodeMaskPng(raster)
  }
  return parts
}
