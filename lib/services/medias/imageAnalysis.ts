import { encode, isBlurhashValid } from 'blurhash'
import sharp from 'sharp'

import { FocalPoint, clampFocalPoint } from '@/lib/utils/focalPoint'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export interface ImageAnalysisResult {
  blurhash: string | null
  focus: FocalPoint | null
}

export interface AnalyzeImageOptions {
  manualFocus?: FocalPoint | null
}

const BLURHASH_MAX_DIMENSION = 32
const BLURHASH_COMPONENTS_X = 4
const BLURHASH_COMPONENTS_Y = 4

// Standard blurhash format regex: base83 characters, length 6 to 100
const BLURHASH_REGEX = /^[0-9a-zA-Z#$%*+,\-.:;=?@[\]^_{|}~]{6,100}$/

/**
 * Whether a string is a blurhash this instance will store and hand to `decode`.
 *
 * BOTH checks are load-bearing and neither subsumes the other.
 *
 * The regex covers the base83 alphabet, which `isBlurhashValid` does not look
 * at — a string of the right length containing `!`, a backslash or a space
 * passes it, and `decode` then happily returns pixels for characters that are
 * not in the alphabet at all.
 *
 * `isBlurhashValid` covers the structure, which the regex cannot see: the
 * required length is `4 + 2 * componentX * componentY`, derived from the size
 * flag in the first character, so `'aaaaaa'` is well-formed base83 of a legal
 * length and still throws `blurhash length mismatch: length is 6 but it should
 * be 14`. That is what a charset-only check let through — a value a remote
 * actor puts on a federated note, stored by `createNoteJob`, that throws every
 * time a client renders the post.
 */
export const isValidBlurhash = (hash?: string | null): boolean => {
  if (!hash || typeof hash !== 'string') return false
  const trimmed = hash.trim()
  if (!BLURHASH_REGEX.test(trimmed)) return false
  return isBlurhashValid(trimmed).result
}

/**
 * Computes BlurHash from an image buffer using Sharp to extract raw RGBA pixels.
 * Resizes to small dimensions (max 32x32) keeping aspect ratio for fast DCT.
 */
export const computeBlurhash = async (
  buffer: Buffer
): Promise<string | null> => {
  try {
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize(BLURHASH_MAX_DIMENSION, BLURHASH_MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    if (!info.width || !info.height || data.length === 0) {
      return null
    }

    const componentX = Math.min(
      Math.max(Math.round(info.width / 8), 3),
      BLURHASH_COMPONENTS_X
    )
    const componentY = Math.min(
      Math.max(Math.round(info.height / 8), 3),
      BLURHASH_COMPONENTS_Y
    )

    return encode(
      new Uint8ClampedArray(data),
      info.width,
      info.height,
      componentX,
      componentY
    )
  } catch (error) {
    logger.warn({
      message: 'Failed to compute image blurhash',
      err: toLoggableError(error)
    })
    return null
  }
}

/**
 * Computes smart focal point using Sharp's attention strategy.
 * Returns normalized coordinates in [-1.0, 1.0] with y-up positive.
 */
export const computeSmartFocus = async (
  buffer: Buffer
): Promise<FocalPoint | null> => {
  try {
    const rotated = sharp(buffer).rotate()
    const metadata = await rotated.metadata()
    const isRotated = Boolean(metadata.orientation && metadata.orientation >= 5)
    const width = (isRotated ? metadata.height : metadata.width) ?? 0
    const height = (isRotated ? metadata.width : metadata.height) ?? 0

    if (width <= 0 || height <= 0) {
      return { x: 0, y: 0 }
    }

    // Resize with cover + attention strategy to trigger libvips saliency detection.
    // Sharp reports attentionX and attentionY on OutputInfo in input image pixel coordinates.
    const { info } = await rotated
      .resize(128, 128, {
        fit: 'cover',
        position: sharp.strategy.attention
      })
      .toBuffer({ resolveWithObject: true })

    if (
      info.attentionX === undefined ||
      info.attentionY === undefined ||
      !Number.isFinite(info.attentionX) ||
      !Number.isFinite(info.attentionY)
    ) {
      return { x: 0, y: 0 }
    }

    const focusX = (info.attentionX / width) * 2 - 1
    const focusY = 1 - (info.attentionY / height) * 2

    return clampFocalPoint(focusX, focusY)
  } catch (error) {
    logger.warn({
      message: 'Failed to compute smart focus',
      err: toLoggableError(error)
    })
    return null
  }
}

/**
 * Analyzes an image buffer, computing blurhash and smart focal point.
 * Never throws: analysis is decoration and degrades to null on error.
 */
export const analyzeImageBuffer = async (
  buffer: Buffer,
  options: AnalyzeImageOptions = {}
): Promise<ImageAnalysisResult> => {
  try {
    const [blurhash, autoFocus] = await Promise.all([
      computeBlurhash(buffer),
      options.manualFocus
        ? Promise.resolve(options.manualFocus)
        : computeSmartFocus(buffer)
    ])

    return {
      blurhash,
      focus: options.manualFocus ?? autoFocus
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to analyze image buffer',
      err: toLoggableError(error)
    })
    return {
      blurhash: null,
      focus: options.manualFocus ?? null
    }
  }
}
