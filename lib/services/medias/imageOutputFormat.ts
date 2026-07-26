import type { Sharp } from 'sharp'

/**
 * Encoding a processed image is stored as.
 *
 * `webp` is the default for every upload: smaller than JPEG at the same
 * quality, and every browser decodes it. `jpeg` exists for the consumers that
 * cannot — Outlook desktop (which renders mail with the Word engine) and
 * Windows Mail have no WebP decoder, so an email pointing at stored WebP bytes
 * shows its alt text instead of the image.
 */
export type ImageOutputFormat = 'webp' | 'jpeg'

export const DEFAULT_IMAGE_OUTPUT_FORMAT: ImageOutputFormat = 'webp'

interface ImageOutputFormatDetail {
  /** File extension, without the leading dot. */
  extension: string
  /** The type actually written — never the input file's type. */
  contentType: string
}

const IMAGE_OUTPUT_FORMAT_DETAILS: Record<
  ImageOutputFormat,
  ImageOutputFormatDetail
> = {
  webp: { extension: 'webp', contentType: 'image/webp' },
  jpeg: { extension: 'jpg', contentType: 'image/jpeg' }
}

export const getImageOutputFormatDetail = (
  format: ImageOutputFormat
): ImageOutputFormatDetail => IMAGE_OUTPUT_FORMAT_DETAILS[format]

/**
 * Applies the encoder for `format` to an already-resized sharp pipeline.
 *
 * Both storage backends encode through here so the settings live in one place
 * instead of drifting between local files and object storage.
 */
export const encodeImageOutput = (
  image: Sharp,
  format: ImageOutputFormat
): Sharp => {
  if (format === 'jpeg') {
    return image.jpeg({
      quality: 90,
      // 4:4:4 for the same reason the WebP encoder gets `smartSubsample`: a
      // route map is a saturated 4px polyline over pale map tiles, and chroma
      // subsampling smears exactly that.
      chromaSubsampling: '4:4:4',
      // Baseline, not progressive. This format exists for Outlook's Word
      // engine, so it stays on the most conservative JPEG variant available.
      progressive: false
    })
  }

  return image.webp({ quality: 95, smartSubsample: true, nearLossless: true })
}
