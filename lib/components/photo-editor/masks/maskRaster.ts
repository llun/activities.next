import type { Size } from '@/lib/services/medias/edit/geometry'
import { MASK_LONG_EDGE, type Recipe } from '@/lib/services/medias/edit/recipe'

// The long edge of every stored mask and of the pixels the model returns is the
// recipe's (the server caps a stored mask at the same size).
export { MASK_LONG_EDGE }

/**
 * One mask's pixels in source space (0 = outside, 255 = inside). The size
 * has the source's aspect and a long edge of at most `MASK_LONG_EDGE`. A
 * raster is never edited in place once it is in the history: an edit makes a
 * new one, so two rasters are the same pixels exactly when they are the same
 * object.
 */
export interface MaskRaster {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** The rasters of a recipe's masks by mask id (background masks have none). */
export type MaskRasters = Readonly<Record<string, MaskRaster>>

export const NO_RASTERS: MaskRasters = Object.freeze({})

/** The mask size for a source: its aspect, the long edge `MASK_LONG_EDGE`. */
export const getMaskSize = (source: Size): Size => {
  const scale = MASK_LONG_EDGE / Math.max(source.width, source.height)
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale))
  }
}

export const createRaster = (size: Size, fill = 0): MaskRaster => ({
  width: size.width,
  height: size.height,
  data: new Uint8ClampedArray(size.width * size.height).fill(fill)
})

export const cloneRaster = (raster: MaskRaster): MaskRaster => ({
  width: raster.width,
  height: raster.height,
  data: new Uint8ClampedArray(raster.data)
})

/** The pixels of 1 - mask (a background mask is the inverse of its subject). */
export const invertRaster = (raster: MaskRaster): MaskRaster => {
  const data = new Uint8ClampedArray(raster.data.length)
  for (let i = 0; i < data.length; i += 1) data[i] = 255 - raster.data[i]
  return { width: raster.width, height: raster.height, data }
}

/** Number of pixels that are at least half inside. */
export const rasterCoverage = (raster: MaskRaster): number => {
  let inside = 0
  for (let i = 0; i < raster.data.length; i += 1) {
    if (raster.data[i] >= 128) inside += 1
  }
  return inside / Math.max(1, raster.data.length)
}

// The rasters travel with a recipe in the editor's history (an undo of a
// brush stroke has to bring the old pixels back), but they are not part of
// the recipe: the symbol key is skipped by JSON, by `Object.keys` and by
// `normalizeRecipe`, and an object spread (every `withX` helper) copies it.
const RASTERS = Symbol('maskRasters')

type WithRasters = Recipe & { [RASTERS]?: MaskRasters }

/** The mask pixels a recipe was made with. */
export const getRasters = (recipe: Recipe): MaskRasters =>
  (recipe as WithRasters)[RASTERS] ?? NO_RASTERS

/** A copy of `recipe` that carries `rasters`. */
export const withRasters = (recipe: Recipe, rasters: MaskRasters): Recipe =>
  ({ ...recipe, [RASTERS]: rasters }) as Recipe

/** Sets or replaces one mask's pixels (null removes them). */
export const withRaster = (
  recipe: Recipe,
  id: string,
  raster: MaskRaster | null
): Recipe => {
  const next: Record<string, MaskRaster> = { ...getRasters(recipe) }
  if (raster) next[id] = raster
  else delete next[id]
  return withRasters(recipe, next)
}

/** True when both recipes carry the same pixels for every mask. */
export const sameRasters = (a: MaskRasters, b: MaskRasters): boolean => {
  if (a === b) return true
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  )
}
