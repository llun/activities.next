import type { Size } from '@/lib/services/medias/edit/geometry'

/** Side of each low-resolution mask the decoder returns. */
export const SAM_MASK_SIDE = 256
/** The decoder proposes this many masks per prompt. */
export const SAM_MASK_COUNT = 3

/** Index of the largest predicted IoU (the first one wins a tie). */
export const pickBestMask = (iouScores: ArrayLike<number>): number => {
  let best = 0
  for (let i = 1; i < iouScores.length; i += 1) {
    if (iouScores[i] > iouScores[best]) best = i
  }
  return best
}

/**
 * Turns the decoder output into the mask the editor keeps: the logits of the
 * proposal with the best IoU are upscaled bilinearly to the 1024 x 1024 plane
 * (a 4x enlargement), cropped to the resized region at its top-left, scaled to
 * `maskSize`, and thresholded at 0. The result is `maskSize.width x
 * maskSize.height` bytes, each 0 or 255.
 *
 * The three steps are one resampling: each output pixel reads the 256 x 256
 * logits at the position the full pipeline would, so the 1024 plane is never
 * built.
 */
export const postprocessSam = (
  iouScores: ArrayLike<number>,
  predMasks: ArrayLike<number>,
  resized: Size,
  maskSize: Size = resized
): Uint8Array => {
  const plane = SAM_MASK_SIDE * SAM_MASK_SIDE
  if (iouScores.length < 1 || predMasks.length < plane * iouScores.length) {
    throw new Error('The decoder output has an unexpected size')
  }
  const offset = pickBestMask(iouScores) * plane
  const side = SAM_MASK_SIDE
  const scaleToPlane = 1024 / side
  const out = new Uint8Array(maskSize.width * maskSize.height)

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
    // Pixel centre in the resized picture, which is also a 1024-plane pixel.
    const py = ((y + 0.5) * resized.height) / maskSize.height - 0.5
    const ly = (py + 0.5) / scaleToPlane - 0.5
    for (let x = 0; x < maskSize.width; x += 1) {
      const px = ((x + 0.5) * resized.width) / maskSize.width - 0.5
      const lx = (px + 0.5) / scaleToPlane - 0.5
      out[y * maskSize.width + x] = sample(lx, ly) > 0 ? 255 : 0
    }
  }
  return out
}
