import type { Size } from '@/lib/services/medias/edit/geometry'
import type { MaskPoint } from '@/lib/services/medias/edit/recipe'

/** The model's square input side. */
export const SAM_INPUT_SIZE = 1024
export const SAM_MEAN = [0.485, 0.456, 0.406] as const
export const SAM_STD = [0.229, 0.224, 0.225] as const

/**
 * The size the picture is scaled to before the model sees it: the long edge
 * becomes 1024 (up or down), the aspect stays. This is also the size of the
 * mask the editor keeps.
 */
export const getSamResize = (source: Size): Size => {
  const scale = SAM_INPUT_SIZE / Math.max(source.width, source.height)
  return {
    width: Math.max(
      1,
      Math.min(SAM_INPUT_SIZE, Math.round(source.width * scale))
    ),
    height: Math.max(
      1,
      Math.min(SAM_INPUT_SIZE, Math.round(source.height * scale))
    )
  }
}

/**
 * The encoder input: `rgba` is the picture already scaled to `resized`
 * (see `getSamResize`). It is rescaled by 1/255, normalized with the ImageNet
 * mean and std, and laid out CHW in a 1024 x 1024 plane, padded with zeros
 * (after normalizing) on the right and bottom. Shape [1, 3, 1024, 1024].
 */
export const preprocessSam = (
  rgba: Uint8ClampedArray | Uint8Array,
  resized: Size
): Float32Array => {
  if (rgba.length !== resized.width * resized.height * 4) {
    throw new Error('The pixels do not match the resized size')
  }
  if (resized.width > SAM_INPUT_SIZE || resized.height > SAM_INPUT_SIZE) {
    throw new Error('The picture is larger than the model input')
  }
  const plane = SAM_INPUT_SIZE * SAM_INPUT_SIZE
  const tensor = new Float32Array(3 * plane)
  for (let y = 0; y < resized.height; y += 1) {
    for (let x = 0; x < resized.width; x += 1) {
      const from = (y * resized.width + x) * 4
      const to = y * SAM_INPUT_SIZE + x
      for (let channel = 0; channel < 3; channel += 1) {
        tensor[channel * plane + to] =
          (rgba[from + channel] / 255 - SAM_MEAN[channel]) / SAM_STD[channel]
      }
    }
  }
  return tensor
}

export const getSamMaskSize = (resized: Size): Size => resized

/** Extracts guide RGBA at maskSize (resampling if maskSize differs from resized). */
export const extractGuideRgba = (
  rgba: Uint8ClampedArray | Uint8Array,
  resized: Size,
  maskSize: Size = getSamMaskSize(resized)
): Uint8ClampedArray => {
  if (rgba.length !== resized.width * resized.height * 4) {
    throw new Error('The pixels do not match the resized size')
  }
  if (maskSize.width === resized.width && maskSize.height === resized.height) {
    return new Uint8ClampedArray(rgba)
  }
  const out = new Uint8ClampedArray(maskSize.width * maskSize.height * 4)
  for (let y = 0; y < maskSize.height; y += 1) {
    const sy = Math.min(
      resized.height - 1,
      Math.max(0, Math.floor(((y + 0.5) * resized.height) / maskSize.height))
    )
    for (let x = 0; x < maskSize.width; x += 1) {
      const sx = Math.min(
        resized.width - 1,
        Math.max(0, Math.floor(((x + 0.5) * resized.width) / maskSize.width))
      )
      const srcIdx = (sy * resized.width + sx) * 4
      const dstIdx = (y * maskSize.width + x) * 4
      out[dstIdx] = rgba[srcIdx]
      out[dstIdx + 1] = rgba[srcIdx + 1]
      out[dstIdx + 2] = rgba[srcIdx + 2]
      out[dstIdx + 3] = rgba[srcIdx + 3]
    }
  }
  return out
}

export interface SamPrompt {
  /** [x0, y0, x1, y1, ...] in pixels of the resized (1024 long edge) picture. */
  coordinates: Float32Array
  /** 1 = this area is part of the subject, 0 = it is not. */
  labels: number[]
}

/** Points in 0..1 image space as the decoder's prompt. */
export const toSamPrompt = (
  points: ReadonlyArray<MaskPoint>,
  resized: Size
): SamPrompt => {
  const coordinates = new Float32Array(points.length * 2)
  points.forEach((point, index) => {
    coordinates[index * 2] = point.x * resized.width
    coordinates[index * 2 + 1] = point.y * resized.height
  })
  return { coordinates, labels: points.map((point) => point.label) }
}
