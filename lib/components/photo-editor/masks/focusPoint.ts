import {
  type Size,
  getGeometryTransform,
  getRecipeOutputSize
} from '@/lib/services/medias/edit/geometry'
import type { Geometry, MaskPoint } from '@/lib/services/medias/edit/recipe'

import { outputToSource } from './maskGeometry'

export interface Focus {
  x: number
  y: number
}

const unit = (value: number) => Math.min(1, Math.max(0, value))

/**
 * The first point of "Select subject": the photo's focus (-1..1, y up) as a
 * positive point in 0..1 image space (y down). With no focus it is the centre.
 */
export const focusToPoint = (focus: Focus | null | undefined): MaskPoint => ({
  x: focus ? unit((focus.x + 1) / 2) : 0.5,
  y: focus ? unit((1 - focus.y) / 2) : 0.5,
  label: 1
})

/**
 * The same for a photo that has been edited: its focus belongs to the saved
 * render, so the point is carried back through that render's geometry into
 * the original, which is the space masks live in.
 */
export const focusToSourcePoint = (
  focus: Focus | null | undefined,
  source: Size,
  renderedGeometry: Geometry | null | undefined
): MaskPoint => {
  const point = focusToPoint(focus)
  if (!focus || !renderedGeometry) return point
  const output = getRecipeOutputSize(source, { geometry: renderedGeometry })
  const matrix = getGeometryTransform(source, renderedGeometry, output)
  const back = outputToSource(
    matrix,
    { x: point.x * output.width, y: point.y * output.height },
    source
  )
  return { x: unit(back.x), y: unit(back.y), label: 1 }
}
