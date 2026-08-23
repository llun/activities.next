/**
 * Focal point utilities for Mastodon-compatible media focal points.
 *
 * Mastodon focal points use coordinate space [-1.0, 1.0] where:
 * - x: -1.0 is far left, 0.0 is center, 1.0 is far right.
 * - y: 1.0 is top, 0.0 is center, -1.0 is bottom (y-up positive).
 *
 * CSS object-position uses percentage [0%, 100%] where:
 * - left: 0% is far left, 50% is center, 100% is far right.
 * - top: 0% is top, 50% is center, 100% is bottom (top-down positive).
 */

export interface FocalPoint {
  x: number
  y: number
}

const clamp = (val: number, min: number, max: number): number =>
  Math.min(Math.max(val, min), max)

export const clampFocalPoint = (x: number, y: number): FocalPoint => ({
  x: Number.isFinite(x) ? clamp(x, -1, 1) : 0,
  y: Number.isFinite(y) ? clamp(y, -1, 1) : 0
})

export const isValidFocalPoint = (x: number, y: number): boolean =>
  Number.isFinite(x) &&
  x >= -1 &&
  x <= 1 &&
  Number.isFinite(y) &&
  y >= -1 &&
  y <= 1

export const focalPointToCssObjectPosition = (
  focus?: FocalPoint | null
): string => {
  if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.y)) {
    return '50% 50%'
  }

  const clamped = clampFocalPoint(focus.x, focus.y)
  const left = ((clamped.x + 1) / 2) * 100
  const top = ((1 - clamped.y) / 2) * 100

  return `${left}% ${top}%`
}
