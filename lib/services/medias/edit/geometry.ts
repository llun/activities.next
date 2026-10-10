import type {
  Aspect,
  CropRect,
  Geometry,
  Recipe
} from '@/lib/services/medias/edit/recipe'
import { MAX_OUTPUT_LONG_EDGE } from '@/lib/services/medias/edit/recipe'

export interface Size {
  width: number
  height: number
}

/**
 * 2D affine matrix in the Canvas2D `setTransform(a, b, c, d, e, f)` layout:
 * x' = a*x + c*y + e, y' = b*x + d*y + f.
 */
export interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** Returns `first` applied after `second` (matrix product first * second). */
const compose = (first: Matrix, second: Matrix): Matrix => ({
  a: first.a * second.a + first.c * second.b,
  b: first.b * second.a + first.d * second.b,
  c: first.a * second.c + first.c * second.d,
  d: first.b * second.c + first.d * second.d,
  e: first.a * second.e + first.c * second.f + first.e,
  f: first.b * second.e + first.d * second.f + first.f
})

type Rotate90 = Geometry['rotate90']

/** Size of the oriented frame (source rotated by `rotate90` quarter turns). */
export const getOrientedSize = (
  source: Size,
  rotate90: Rotate90 | number
): Size =>
  rotate90 % 2 === 0
    ? { width: source.width, height: source.height }
    : { width: source.height, height: source.width }

/**
 * Output pixel size of a recipe: the crop in the oriented frame, scaled down
 * so the long edge is at most `MAX_OUTPUT_LONG_EDGE`, rounded, minimum 1.
 * The client renders at this size and the server checks the upload against it.
 */
export const getRecipeOutputSize = (
  source: Size,
  recipe: Pick<Recipe, 'geometry'>
): Size => {
  const { geometry } = recipe
  const oriented = getOrientedSize(source, geometry.rotate90)
  let width = geometry.crop.width * oriented.width
  let height = geometry.crop.height * oriented.height
  const longEdge = Math.max(width, height)
  if (longEdge > MAX_OUTPUT_LONG_EDGE) {
    const factor = MAX_OUTPUT_LONG_EDGE / longEdge
    width *= factor
    height *= factor
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height))
  }
}

/**
 * Shrinks the crop about its centre (keeping its aspect) until it can sit
 * inside the oriented image once rotated by `straighten`, then slides it
 * back inside. A crop that already fits is returned unchanged. All four
 * rotated corners end up inside [0, W'] x [0, H'].
 */
export const clampCropToImage = (
  crop: CropRect,
  straighten: number,
  orientedSize: Size
): CropRect => {
  const { width: W, height: H } = orientedSize
  const cw = crop.width * W
  const ch = crop.height * H
  const theta = (straighten * Math.PI) / 180
  const cos = Math.abs(Math.cos(theta))
  const sin = Math.abs(Math.sin(theta))
  // Half extents of the rotated rectangle's bounding box at scale 1
  const ex = (cw / 2) * cos + (ch / 2) * sin
  const ey = (cw / 2) * sin + (ch / 2) * cos

  // Largest scale at which the rotated crop fits anywhere in the image
  const scale = Math.min(1, W / (2 * ex), H / (2 * ey))
  const halfW = (cw / 2) * scale
  const halfH = (ch / 2) * scale
  const boundX = ex * scale
  const boundY = ey * scale

  const clamp = (v: number, min: number, max: number) =>
    Math.min(Math.max(v, min), max)
  const centreX = clamp(
    (crop.x + crop.width / 2) * W,
    boundX,
    Math.max(boundX, W - boundX)
  )
  const centreY = clamp(
    (crop.y + crop.height / 2) * H,
    boundY,
    Math.max(boundY, H - boundY)
  )

  const width = (halfW * 2) / W
  const height = (halfH * 2) / H
  return {
    x: clamp((centreX - halfW) / W, 0, 1 - width),
    y: clamp((centreY - halfH) / H, 0, 1 - height),
    width,
    height
  }
}

const FIXED_RATIOS: Partial<Record<Aspect, number>> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '3:2': 3 / 2,
  '16:9': 16 / 9
}

/**
 * Largest crop of the given ratio centred on the current crop centre, then
 * clamped (pass `straighten` so the clamp accounts for it). `original` uses
 * W':H' of the oriented frame, `free` returns `current` untouched, and
 * `portrait` swaps w:h of the fixed ratios.
 */
export const aspectCrop = (
  aspect: Aspect,
  portrait: boolean,
  orientedSize: Size,
  current: CropRect,
  straighten = 0
): CropRect => {
  if (aspect === 'free') return current
  const { width: W, height: H } = orientedSize
  let ratio = W / H
  if (aspect !== 'original') {
    const fixed = FIXED_RATIOS[aspect] ?? ratio
    ratio = portrait ? 1 / fixed : fixed
  }
  // Largest ratio-shaped rectangle that fits the image at straighten 0
  const pxWidth = Math.min(W, H * ratio)
  const pxHeight = pxWidth / ratio
  const width = Math.min(1, pxWidth / W)
  const height = Math.min(1, pxHeight / H)
  const centreX = current.x + current.width / 2
  const centreY = current.y + current.height / 2
  return clampCropToImage(
    {
      x: Math.min(Math.max(centreX - width / 2, 0), 1 - width),
      y: Math.min(Math.max(centreY - height / 2, 0), 1 - height),
      width,
      height
    },
    straighten,
    orientedSize
  )
}

/**
 * Source-pixel to output-pixel matrix for `setTransform`. Order: rotate the
 * source `rotate90` times clockwise, mirror when `flipH`, move the crop
 * centre to the origin, rotate by `straighten` (clockwise for positive),
 * scale to the output size, and move to the output centre.
 * `output` defaults to `getRecipeOutputSize`.
 */
export const getGeometryTransform = (
  source: Size,
  geometry: Geometry,
  output?: Size
): Matrix => {
  const out = output ?? getRecipeOutputSize(source, { geometry })

  let matrix = IDENTITY
  let size: Size = source
  for (let i = 0; i < geometry.rotate90; i++) {
    // Clockwise quarter turn: (x, y) -> (height - y, x)
    matrix = compose({ a: 0, b: 1, c: -1, d: 0, e: size.height, f: 0 }, matrix)
    size = { width: size.height, height: size.width }
  }
  if (geometry.flipH) {
    matrix = compose({ a: -1, b: 0, c: 0, d: 1, e: size.width, f: 0 }, matrix)
  }

  const cropCentreX = (geometry.crop.x + geometry.crop.width / 2) * size.width
  const cropCentreY = (geometry.crop.y + geometry.crop.height / 2) * size.height
  const scale = out.width / (geometry.crop.width * size.width)
  const theta = (geometry.straighten * Math.PI) / 180
  const cos = Math.cos(theta) * scale
  const sin = Math.sin(theta) * scale

  const orientedToOutput: Matrix = {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: out.width / 2 - (cos * cropCentreX - sin * cropCentreY),
    f: out.height / 2 - (sin * cropCentreX + cos * cropCentreY)
  }
  return compose(orientedToOutput, matrix)
}

/** Maps a crop through a counterclockwise quarter turn of the oriented frame. */
const turnCropCounterclockwise = (crop: CropRect): CropRect => ({
  x: crop.y,
  y: 1 - crop.x - crop.width,
  width: crop.height,
  height: crop.width
})

/**
 * The Rotate button: turns the picture 90 degrees counterclockwise on screen.
 * The crop is remapped into the new oriented frame so the same image region
 * stays selected. Without a flip this is `rotate90 = (r + 3) % 4`; with
 * `flipH` the mirror reverses the sense of the stored turn, so it is
 * `(r + 1) % 4` and the picture still turns counterclockwise on screen.
 * Straighten is unchanged. A fixed ratio swaps portrait/landscape.
 */
export const rotateGeometry90 = (geometry: Geometry): Geometry => {
  const rotate90 = ((geometry.rotate90 + (geometry.flipH ? 1 : 3)) %
    4) as Rotate90
  const fixedRatio =
    geometry.aspect !== 'original' && geometry.aspect !== 'free'
  return {
    ...geometry,
    rotate90,
    crop: turnCropCounterclockwise(geometry.crop),
    ...(fixedRatio ? { aspectPortrait: !geometry.aspectPortrait } : {})
  }
}

/**
 * The Flip button: toggles `flipH`, mirrors `crop.x` (x = 1 - x - width) and
 * negates `straighten` so the same image region stays selected.
 */
export const flipGeometryHorizontal = (geometry: Geometry): Geometry => ({
  ...geometry,
  flipH: !geometry.flipH,
  straighten: geometry.straighten === 0 ? 0 : -geometry.straighten,
  crop: { ...geometry.crop, x: 1 - geometry.crop.x - geometry.crop.width }
})
