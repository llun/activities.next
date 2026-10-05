import { MediaValidationError } from './errors'
import type { FfprobeData } from './extractVideoMeta'

// The largest frame side an uploaded video may have. 8K (7680x4320) fits;
// beyond that is not a video anyone posts, while every decoded frame costs
// memory in proportion to its area (ffmpeg's preview extraction included).
export const MAX_VIDEO_DIMENSION = 8192

/**
 * The single acceptance rule for an uploaded video's probe, shared by both
 * storage drivers' synchronous paths and the presigned completion so they
 * cannot drift: a video stream in an mp4 or webm container, no side above
 * `MAX_VIDEO_DIMENSION`. Throws `MediaValidationError` (the caller's 422).
 */
export const getAcceptedVideoDimensions = (
  probe: FfprobeData
): { width?: number; height?: number } => {
  const videoStream = probe.streams.find(
    (stream) => stream.codec_type === 'video'
  )
  const formats = probe.format.format_name?.split(',')
  if (
    !videoStream ||
    !(formats?.includes('mp4') || formats?.includes('webm'))
  ) {
    throw new MediaValidationError('Invalid video format')
  }

  const { width, height } = videoStream
  if (
    (width ?? 0) > MAX_VIDEO_DIMENSION ||
    (height ?? 0) > MAX_VIDEO_DIMENSION
  ) {
    throw new MediaValidationError(
      `Video dimensions exceed ${MAX_VIDEO_DIMENSION}x${MAX_VIDEO_DIMENSION}`
    )
  }
  return { width, height }
}
