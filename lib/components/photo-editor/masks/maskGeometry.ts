import type { Matrix, Size } from '@/lib/services/medias/edit/geometry'

export interface Point {
  x: number
  y: number
}

/** The inverse of an affine matrix, or null when it is singular. */
export const invertMatrix = (m: Matrix): Matrix | null => {
  const det = m.a * m.d - m.b * m.c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det
  }
}

export const applyMatrix = (m: Matrix, p: Point): Point => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f
})

/**
 * A source-space point (0..1 on both axes) in output pixels, through the
 * source-to-output matrix of the geometry.
 */
export const sourceToOutput = (
  matrix: Matrix,
  point: Point,
  source: Size
): Point =>
  applyMatrix(matrix, {
    x: point.x * source.width,
    y: point.y * source.height
  })

/** An output pixel back in source space, 0..1 on both axes (may be outside). */
export const outputToSource = (
  matrix: Matrix,
  point: Point,
  source: Size
): Point => {
  const inverse = invertMatrix(matrix)
  if (!inverse) return { x: 0.5, y: 0.5 }
  const p = applyMatrix(inverse, point)
  return { x: p.x / source.width, y: p.y / source.height }
}

/** Output pixels per source pixel (the matrix's uniform scale). */
export const matrixScale = (m: Matrix): number => Math.hypot(m.a, m.b)
