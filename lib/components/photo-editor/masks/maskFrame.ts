import {
  type DrawableCanvas,
  createCanvas
} from '@/lib/components/photo-editor/engine/geometryCanvas'
import type { MaskFrame } from '@/lib/components/photo-editor/engine/glRenderer'
import {
  type Size,
  getGeometryTransform
} from '@/lib/services/medias/edit/geometry'
import type { Geometry, Recipe } from '@/lib/services/medias/edit/recipe'

import {
  MASK_LONG_EDGE,
  type MaskRaster,
  type MaskRasters,
  invertRaster
} from './maskRaster'

/** The frame size for an output: its aspect, a long edge of at most 1024. */
export const getMaskFrameSize = (output: Size): Size => {
  const scale = Math.min(
    1,
    MASK_LONG_EDGE / Math.max(output.width, output.height)
  )
  return {
    width: Math.max(1, Math.round(output.width * scale)),
    height: Math.max(1, Math.round(output.height * scale))
  }
}

/**
 * The raster a mask paints with: its own pixels, or for a background the
 * inverse of the subject it follows. Null when there are none (yet).
 */
export const getMaskRaster = (
  mask: Recipe['masks'][number],
  rasters: MaskRasters
): MaskRaster | null => {
  if (mask.kind === 'background') {
    const subject = mask.of ? rasters[mask.of] : undefined
    return subject ? invertRaster(subject) : null
  }
  return rasters[mask.id] ?? null
}

/** Packs up to four alpha planes into one RGBA frame (channel i = plane i). */
export const packChannels = (
  channels: ReadonlyArray<Uint8ClampedArray | null>,
  size: Size
): MaskFrame => {
  const count = size.width * size.height
  const data = new Uint8ClampedArray(count * 4)
  channels.slice(0, 4).forEach((plane, channel) => {
    if (!plane) return
    for (let i = 0; i < count; i += 1) data[i * 4 + channel] = plane[i]
  })
  return { size, data }
}

const rasterCanvases = new WeakMap<MaskRaster, DrawableCanvas>()

/** The raster as a canvas whose alpha is the mask value. */
const toAlphaCanvas = (raster: MaskRaster): DrawableCanvas => {
  const cached = rasterCanvases.get(raster)
  if (cached) return cached
  const canvas = createCanvas(raster.width, raster.height)
  const context = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('2D canvas is not available')
  const image = new ImageData(raster.width, raster.height)
  for (let i = 0; i < raster.data.length; i += 1) {
    image.data[i * 4] = 255
    image.data[i * 4 + 1] = 255
    image.data[i * 4 + 2] = 255
    image.data[i * 4 + 3] = raster.data[i]
  }
  context.putImageData(image, 0, 0)
  rasterCanvases.set(raster, canvas)
  return canvas
}

/**
 * One mask through the recipe's geometry: its alpha at `frame` size (0 where
 * the frame shows nothing of the photo). The raster is stretched over the
 * source, then drawn with the same matrix the photo itself uses.
 */
export const renderMaskChannel = (
  raster: MaskRaster,
  source: Size,
  geometry: Geometry,
  frame: Size
): Uint8ClampedArray => {
  const canvas = createCanvas(frame.width, frame.height)
  const context = canvas.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('2D canvas is not available')
  const matrix = getGeometryTransform(source, geometry, frame)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.setTransform(
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.e,
    matrix.f
  )
  context.drawImage(toAlphaCanvas(raster), 0, 0, source.width, source.height)
  const pixels = context.getImageData(0, 0, frame.width, frame.height).data
  const alpha = new Uint8ClampedArray(frame.width * frame.height)
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels[i * 4 + 3]
  canvas.width = 0
  canvas.height = 0
  return alpha
}

let nextRasterId = 1
const rasterIds = new WeakMap<MaskRaster, number>()
const rasterId = (raster: MaskRaster) => {
  let id = rasterIds.get(raster)
  if (!id) {
    id = nextRasterId
    nextRasterId += 1
    rasterIds.set(raster, id)
  }
  return id
}

/**
 * Builds the packed mask frame of a recipe for a frame size, keeping each
 * mask's geometry-transformed plane until its pixels or the geometry change.
 */
export const createMaskFrameBuilder = () => {
  const planes = new Map<string, { key: string; plane: Uint8ClampedArray }>()

  const build = (
    masks: Recipe['masks'],
    rasters: MaskRasters,
    source: Size,
    geometry: Geometry,
    frame: Size
  ): MaskFrame | null => {
    if (masks.length === 0) return null
    const geometryKey = `${JSON.stringify(geometry)}|${frame.width}x${frame.height}|${source.width}x${source.height}`
    const live = new Set<string>()
    const channels = masks.map((mask) => {
      live.add(mask.id)
      const own = mask.kind === 'background' ? null : rasters[mask.id]
      const subject =
        mask.kind === 'background' && mask.of ? rasters[mask.of] : undefined
      const base = own ?? subject
      if (!base) return null
      const key = `${geometryKey}|${mask.kind}|${rasterId(base)}`
      const cached = planes.get(mask.id)
      if (cached?.key === key) return cached.plane
      const raster = getMaskRaster(mask, rasters)
      if (!raster) return null
      const plane = renderMaskChannel(raster, source, geometry, frame)
      planes.set(mask.id, { key, plane })
      return plane
    })
    for (const id of planes.keys()) if (!live.has(id)) planes.delete(id)
    return packChannels(channels, frame)
  }

  return { build, clear: () => planes.clear() }
}
