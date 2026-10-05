import sharp from 'sharp'

import { MediaValidationError } from './errors'
import { extractVideoMetaFromFile } from './extractVideoMeta'
import { getAcceptedVideoDimensions } from './videoProbe'

export class PresignedUploadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresignedUploadValidationError'
  }
}

// What sharp reports for each accepted image type. The declared type must be
// the format the bytes actually are, or the object is not what its row says.
const SHARP_FORMAT_BY_IMAGE_TYPE: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png'
}

const probeImage = async (filePath: string, contentType: string) => {
  const expectedFormat = SHARP_FORMAT_BY_IMAGE_TYPE[contentType]
  const metadata = await sharp(filePath)
    .metadata()
    .catch(() => {
      throw new PresignedUploadValidationError(
        'Uploaded object is not an image'
      )
    })
  if (!expectedFormat || metadata.format !== expectedFormat) {
    throw new PresignedUploadValidationError(
      'Uploaded object does not match its declared image type'
    )
  }
  // Display dimensions: EXIF orientations 5-8 swap width and height.
  const width = metadata.autoOrient?.width ?? metadata.width
  const height = metadata.autoOrient?.height ?? metadata.height
  if (!width || !height) {
    throw new PresignedUploadValidationError('Uploaded image has no dimensions')
  }
  return { width, height }
}

const probeContainer = async (filePath: string) =>
  extractVideoMetaFromFile(filePath).catch(() => {
    throw new PresignedUploadValidationError(
      'Uploaded object is not a readable media file'
    )
  })

const probeVideo = async (filePath: string) => {
  const probe = await probeContainer(filePath)
  try {
    const { width, height } = getAcceptedVideoDimensions(probe)
    return { width: width ?? 0, height: height ?? 0 }
  } catch (error) {
    if (error instanceof MediaValidationError) {
      throw new PresignedUploadValidationError(error.message)
    }
    throw error
  }
}

const probeAudio = async (filePath: string) => {
  const probe = await probeContainer(filePath)
  const hasAudio = probe.streams.some((stream) => stream.codec_type === 'audio')
  const formats = probe.format.format_name?.split(',')
  if (!hasAudio || !formats?.includes('mp4')) {
    throw new PresignedUploadValidationError('Invalid audio format')
  }
  return { width: 0, height: 0 }
}

/**
 * Probes a presigned upload's bytes (already downloaded to a server-named temp
 * file) as the type the client declared, and returns its real dimensions.
 *
 * The presigned flow stores the client's bytes as-is, and everything checked
 * before this — size, content type, checksum — only compares the object with
 * the client's own claims. This is the step that confirms the bytes ARE an
 * image, video or audio file of that type, the way the synchronous upload path
 * does by decoding them. Any failure is a `PresignedUploadValidationError`, so
 * the caller deletes the object and the row rather than leaving arbitrary
 * bytes hosted under the instance's media URL.
 */
export const probePresignedMedia = async (
  filePath: string,
  contentType: string
): Promise<{ width: number; height: number }> => {
  if (contentType.startsWith('image/')) {
    return probeImage(filePath, contentType)
  }
  if (contentType.startsWith('video/')) {
    return probeVideo(filePath)
  }
  if (contentType.startsWith('audio/')) {
    return probeAudio(filePath)
  }
  throw new PresignedUploadValidationError('Unsupported media type')
}
