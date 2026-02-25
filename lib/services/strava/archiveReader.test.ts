import { gzipSync } from 'zlib'

import {
  getArchiveMediaMimeType,
  toStravaArchiveFitnessFilePayload
} from '@/lib/services/strava/archiveReader'

describe('archiveReader helpers', () => {
  describe('getArchiveMediaMimeType', () => {
    it('returns supported media MIME types', () => {
      expect(getArchiveMediaMimeType('media/photo.jpg')).toBe('image/jpeg')
      expect(getArchiveMediaMimeType('media/photo.jpeg')).toBe('image/jpeg')
      expect(getArchiveMediaMimeType('media/photo.png')).toBe('image/png')
      expect(getArchiveMediaMimeType('media/video.mp4')).toBe('video/mp4')
      expect(getArchiveMediaMimeType('media/video.mov')).toBe('video/quicktime')
      expect(getArchiveMediaMimeType('media/video.webm')).toBe('video/webm')
    })

    it('returns undefined for unsupported media types', () => {
      expect(getArchiveMediaMimeType('media/clip.heic')).toBeUndefined()
      expect(getArchiveMediaMimeType('media/clip.gif')).toBeUndefined()
    })
  })

  describe('toStravaArchiveFitnessFilePayload', () => {
    it('builds payload for uncompressed fitness file', () => {
      const payload = toStravaArchiveFitnessFilePayload({
        fitnessFilePath: 'activities/123.gpx',
        buffer: Buffer.from('<gpx />')
      })

      expect(payload.fileType).toBe('gpx')
      expect(payload.fileName).toBe('123.gpx')
      expect(payload.mimeType).toBe('application/gpx+xml')
      expect(payload.buffer.toString()).toBe('<gpx />')
    })

    it('gunzips compressed fitness file payloads', () => {
      const payload = toStravaArchiveFitnessFilePayload({
        fitnessFilePath: 'activities/123.fit.gz',
        buffer: gzipSync(Buffer.from('fit-binary'))
      })

      expect(payload.fileType).toBe('fit')
      expect(payload.fileName).toBe('123.fit')
      expect(payload.mimeType).toBe('application/vnd.ant.fit')
      expect(payload.buffer.toString()).toBe('fit-binary')
    })

    it('throws for unsupported fitness files', () => {
      expect(() =>
        toStravaArchiveFitnessFilePayload({
          fitnessFilePath: 'activities/123.csv',
          buffer: Buffer.from('bad')
        })
      ).toThrow('Unsupported fitness file path')
    })
  })
})
