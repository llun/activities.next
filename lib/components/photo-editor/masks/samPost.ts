import type { Size } from '@/lib/services/medias/edit/geometry'

import { refineMaskWithGuide } from './guidedFilter'

/** Side of each low-resolution mask the decoder returns. */
export const SAM_MASK_SIDE = 256
/** The decoder proposes this many masks per prompt. */
export const SAM_MASK_COUNT = 3

export const getSamMaskSize = (resized: Size): Size => resized

/** Index of the largest predicted IoU, with degenerate rejection and whole-object bonus. */
export const pickBestMask = (
  iouScores: ArrayLike<number>,
  predMasks?: ArrayLike<number>,
  resized?: Size
): number => {
  if (!predMasks || !resized || iouScores.length <= 1) {
    let best = 0
    for (let i = 1; i < iouScores.length; i += 1) {
      if (iouScores[i] > iouScores[best]) best = i
    }
    return best
  }

  const count = iouScores.length
  const plane = SAM_MASK_SIDE * SAM_MASK_SIDE
  const planeW = Math.min(
    SAM_MASK_SIDE,
    Math.max(1, Math.round(resized.width / 4))
  )
  const planeH = Math.min(
    SAM_MASK_SIDE,
    Math.max(1, Math.round(resized.height / 4))
  )
  const totalValid = planeW * planeH

  const areaFractions: number[] = new Array(count)
  for (let m = 0; m < count; m += 1) {
    const offset = m * plane
    let inside = 0
    for (let y = 0; y < planeH; y += 1) {
      const row = offset + y * SAM_MASK_SIDE
      for (let x = 0; x < planeW; x += 1) {
        if (predMasks[row + x] > 0) inside += 1
      }
    }
    areaFractions[m] = inside / totalValid
  }

  const hasValidArea = areaFractions.some((f) => f >= 0.004 && f <= 0.94)

  let maxRawIou = -Infinity
  for (let m = 0; m < count; m += 1) {
    const val = Number(iouScores[m] ?? 0)
    if (val > maxRawIou) maxRawIou = val
  }

  const scores: number[] = new Array(count)
  for (let m = 0; m < count; m += 1) {
    const rawIou = Number(iouScores[m] ?? 0)
    let score = rawIou
    const frac = areaFractions[m]
    if (hasValidArea && (frac < 0.004 || frac > 0.94)) {
      score -= 0.5
    }
    if (rawIou >= maxRawIou - 0.12 && frac <= 0.85) {
      if (m === 2) score += 0.08
      else if (m === 1) score += 0.04
    }
    scores[m] = score
  }

  let best = 0
  for (let m = 1; m < count; m += 1) {
    if (scores[m] > scores[best]) best = m
  }
  return best
}

/**
 * Turns the decoder output into the mask the editor keeps: the logits of the
 * proposal with the best IoU are upscaled bilinearly to the 1024 x 1024 plane
 * (a 4x enlargement), cropped to the resized region at its top-left, scaled to
 * `maskSize`, and thresholded with a soft logistic ramp.
 */
export const postprocessSam = (
  iouScores: ArrayLike<number>,
  predMasks: ArrayLike<number>,
  resized: Size,
  maskSize: Size = getSamMaskSize(resized),
  guideRgba?: Uint8ClampedArray
): Uint8ClampedArray => {
  const plane = SAM_MASK_SIDE * SAM_MASK_SIDE
  if (iouScores.length < 1 || predMasks.length < plane * iouScores.length) {
    throw new Error('The decoder output has an unexpected size')
  }
  const offset = pickBestMask(iouScores, predMasks, resized) * plane
  const side = SAM_MASK_SIDE
  const scaleToPlane = 1024 / side
  const out = new Uint8ClampedArray(maskSize.width * maskSize.height)

  const sample = (lx: number, ly: number) => {
    const x = Math.min(side - 1, Math.max(0, lx))
    const y = Math.min(side - 1, Math.max(0, ly))
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(side - 1, x0 + 1)
    const y1 = Math.min(side - 1, y0 + 1)
    const fx = x - x0
    const fy = y - y0
    const top =
      predMasks[offset + y0 * side + x0] * (1 - fx) +
      predMasks[offset + y0 * side + x1] * fx
    const bottom =
      predMasks[offset + y1 * side + x0] * (1 - fx) +
      predMasks[offset + y1 * side + x1] * fx
    return top * (1 - fy) + bottom * fy
  }

  for (let y = 0; y < maskSize.height; y += 1) {
    const py = ((y + 0.5) * resized.height) / maskSize.height - 0.5
    const ly = (py + 0.5) / scaleToPlane - 0.5
    for (let x = 0; x < maskSize.width; x += 1) {
      const px = ((x + 0.5) * resized.width) / maskSize.width - 0.5
      const lx = (px + 0.5) / scaleToPlane - 0.5
      const v = sample(lx, ly)
      if (v >= 3.0) {
        out[y * maskSize.width + x] = 255
      } else if (v <= -3.0) {
        out[y * maskSize.width + x] = 0
      } else {
        out[y * maskSize.width + x] = Math.round(
          (1 / (1 + Math.exp(-v * 2.2))) * 255
        )
      }
    }
  }

  if (guideRgba && guideRgba.length === maskSize.width * maskSize.height * 4) {
    return refineMaskWithGuide(out, guideRgba, maskSize.width, maskSize.height)
  }

  return out
}
