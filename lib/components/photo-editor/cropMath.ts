import {
  type Size,
  clampCropToImage
} from '@/lib/services/medias/edit/geometry'
import type { Aspect, CropRect } from '@/lib/services/medias/edit/recipe'

export interface Point {
  x: number
  y: number
}

/** Handle directions: -1 / 0 / 1 along each axis of the crop's own frame. */
export interface HandleDirection {
  id: string
  x: -1 | 0 | 1
  y: -1 | 0 | 1
  label: string
}

export const HANDLES: ReadonlyArray<HandleDirection> = [
  { id: 'nw', x: -1, y: -1, label: 'Top left corner' },
  { id: 'n', x: 0, y: -1, label: 'Top edge' },
  { id: 'ne', x: 1, y: -1, label: 'Top right corner' },
  { id: 'e', x: 1, y: 0, label: 'Right edge' },
  { id: 'se', x: 1, y: 1, label: 'Bottom right corner' },
  { id: 's', x: 0, y: 1, label: 'Bottom edge' },
  { id: 'sw', x: -1, y: 1, label: 'Bottom left corner' },
  { id: 'w', x: -1, y: 0, label: 'Left edge' }
]

const FIXED_RATIOS: Partial<Record<Aspect, number>> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '3:2': 3 / 2,
  '16:9': 16 / 9
}

/** Width over height a drag must keep, or null for a free crop. */
export const getAspectRatio = (
  aspect: Aspect,
  portrait: boolean,
  oriented: Size
): number | null => {
  if (aspect === 'free') return null
  if (aspect === 'original') return oriented.width / oriented.height
  const fixed = FIXED_RATIOS[aspect] ?? 1
  return portrait ? 1 / fixed : fixed
}

const radians = (degrees: number) => (degrees * Math.PI) / 180

/** Rotates a vector clockwise (on screen, y down) by `degrees`. */
const rotate = (x: number, y: number, degrees: number): Point => {
  const cos = Math.cos(radians(degrees))
  const sin = Math.sin(radians(degrees))
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

/** The crop in oriented-image pixels: centre and half extents. */
export const cropToPixels = (crop: CropRect, oriented: Size) => ({
  centre: {
    x: (crop.x + crop.width / 2) * oriented.width,
    y: (crop.y + crop.height / 2) * oriented.height
  },
  halfWidth: (crop.width * oriented.width) / 2,
  halfHeight: (crop.height * oriented.height) / 2
})

/**
 * The crop's four corners and 8 handle points on the oriented image, in
 * oriented pixels. The output is the crop rotated by `straighten`, so its
 * footprint on the source is rotated the other way.
 */
export const getHandlePoints = (
  crop: CropRect,
  straighten: number,
  oriented: Size
): Array<{ handle: HandleDirection } & Point> => {
  const { centre, halfWidth, halfHeight } = cropToPixels(crop, oriented)
  return HANDLES.map((handle) => {
    const offset = rotate(
      handle.x * halfWidth,
      handle.y * halfHeight,
      -straighten
    )
    return { handle, x: centre.x + offset.x, y: centre.y + offset.y }
  })
}

const toCrop = (
  centre: Point,
  width: number,
  height: number,
  oriented: Size
): CropRect => ({
  x: (centre.x - width / 2) / oriented.width,
  y: (centre.y - height / 2) / oriented.height,
  width: width / oriented.width,
  height: height / oriented.height
})

const clampPoint = (point: Point, oriented: Size): Point => ({
  x: Math.min(Math.max(point.x, 0), oriented.width),
  y: Math.min(Math.max(point.y, 0), oriented.height)
})

/**
 * Drags one handle of the crop to `pointer` (oriented pixels). The opposite
 * edge or corner stays put, measured in the crop's own (rotated) frame. With
 * a `ratio`, the width over height is kept.
 */
export const resizeCrop = (
  start: CropRect,
  direction: Pick<HandleDirection, 'x' | 'y'>,
  pointer: Point,
  straighten: number,
  oriented: Size,
  ratio: number | null
): CropRect => {
  const { centre, halfWidth, halfHeight } = cropToPixels(start, oriented)
  const target = clampPoint(pointer, oriented)
  const local = rotate(target.x - centre.x, target.y - centre.y, straighten)
  const minWidth = Math.max(8, oriented.width * 0.03)
  const minHeight = Math.max(8, oriented.height * 0.03)

  // The anchor is the opposite edge (or corner) in the crop's frame.
  const anchorX = -direction.x * halfWidth
  const anchorY = -direction.y * halfHeight
  let width =
    direction.x === 0 ? halfWidth * 2 : direction.x * (local.x - anchorX)
  let height =
    direction.y === 0 ? halfHeight * 2 : direction.y * (local.y - anchorY)
  width = Math.max(width, minWidth)
  height = Math.max(height, minHeight)

  if (ratio !== null) {
    if (direction.x !== 0 && direction.y !== 0) {
      width = Math.max(width, height * ratio)
    } else if (direction.x !== 0) {
      // An edge handle changes the size along its own axis only.
    } else {
      width = height * ratio
    }
    height = width / ratio
    if (direction.y === 0) {
      // Width drove the size; keep the crop's middle on its own axis.
    }
  }

  const localCentre: Point = {
    x: direction.x === 0 ? 0 : anchorX + (direction.x * width) / 2,
    y: direction.y === 0 ? 0 : anchorY + (direction.y * height) / 2
  }
  const offset = rotate(localCentre.x, localCentre.y, -straighten)
  return clampCropToImage(
    toCrop(
      { x: centre.x + offset.x, y: centre.y + offset.y },
      width,
      height,
      oriented
    ),
    straighten,
    oriented
  )
}

/** Moves the whole crop by (`dx`, `dy`) oriented pixels. */
export const moveCrop = (
  start: CropRect,
  dx: number,
  dy: number,
  straighten: number,
  oriented: Size
): CropRect =>
  clampCropToImage(
    {
      ...start,
      x: start.x + dx / oriented.width,
      y: start.y + dy / oriented.height
    },
    straighten,
    oriented
  )
