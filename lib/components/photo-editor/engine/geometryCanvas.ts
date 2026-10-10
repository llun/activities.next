import {
  type Size,
  getGeometryTransform
} from '@/lib/services/medias/edit/geometry'
import type { Geometry } from '@/lib/services/medias/edit/recipe'

import type { TileRect } from './tiles'

export type DrawableCanvas = HTMLCanvasElement | OffscreenCanvas

export const createCanvas = (width: number, height: number): DrawableCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * Draws the source through the recipe's geometry (rotate, flip, straighten,
 * crop) at `outWidth` x `outHeight`, using one `setTransform`. With `region`,
 * only that rect of the output is drawn, into a canvas of the rect's size
 * (the tiled export for outputs wider than a texture).
 */
export const drawGeometry = (
  source: ImageBitmap,
  geometry: Geometry,
  outWidth: number,
  outHeight: number,
  region?: TileRect
): DrawableCanvas => {
  const width = region ? region.w : outWidth
  const height = region ? region.h : outHeight
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d', { colorSpace: 'srgb' }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('2D canvas is not available')
  const sourceSize: Size = { width: source.width, height: source.height }
  const matrix = getGeometryTransform(sourceSize, geometry, {
    width: outWidth,
    height: outHeight
  })
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.setTransform(
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.e - (region?.x ?? 0),
    matrix.f - (region?.y ?? 0)
  )
  context.drawImage(source, 0, 0)
  return canvas
}
