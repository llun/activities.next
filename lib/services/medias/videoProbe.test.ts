import { MediaValidationError } from './errors'
import { MAX_VIDEO_DIMENSION, getAcceptedVideoDimensions } from './videoProbe'

const probeOf = (
  stream: { codec_type?: string; width?: number; height?: number },
  formatName = 'mov,mp4,m4a,3gp,3g2,mj2'
) => ({ streams: [stream], format: { format_name: formatName } })

describe('getAcceptedVideoDimensions', () => {
  it('returns the probed dimensions of an accepted video', () => {
    expect(
      getAcceptedVideoDimensions(
        probeOf({ codec_type: 'video', width: 3840, height: 2160 })
      )
    ).toEqual({ width: 3840, height: 2160 })
  })

  it('accepts a webm container', () => {
    expect(
      getAcceptedVideoDimensions(
        probeOf(
          { codec_type: 'video', width: 640, height: 480 },
          'matroska,webm'
        )
      )
    ).toEqual({ width: 640, height: 480 })
  })

  it('accepts a frame exactly at the cap', () => {
    expect(() =>
      getAcceptedVideoDimensions(
        probeOf({
          codec_type: 'video',
          width: MAX_VIDEO_DIMENSION,
          height: MAX_VIDEO_DIMENSION
        })
      )
    ).not.toThrow()
  })

  it.each([
    { width: MAX_VIDEO_DIMENSION + 1, height: 1080 },
    { width: 1080, height: MAX_VIDEO_DIMENSION + 1 }
  ])('rejects a frame of $width x $height', ({ width, height }) => {
    expect(() =>
      getAcceptedVideoDimensions(
        probeOf({ codec_type: 'video', width, height })
      )
    ).toThrow(MediaValidationError)
  })

  it('rejects a container with no video stream', () => {
    expect(() =>
      getAcceptedVideoDimensions(probeOf({ codec_type: 'audio' }))
    ).toThrow(MediaValidationError)
  })

  it('rejects a container that is not mp4 or webm', () => {
    expect(() =>
      getAcceptedVideoDimensions(
        probeOf({ codec_type: 'video', width: 640, height: 480 }, 'avi')
      )
    ).toThrow(MediaValidationError)
  })
})
