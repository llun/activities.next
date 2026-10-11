import sharp from 'sharp'

import {
  extractJpegExifSegment,
  insertJpegExifSegment
} from '@/lib/utils/jpegExif'

/**
 * The byte shape the browser uploads: a plain canvas-encoded JPEG with the
 * original photo's Exif APP1 segment (Make, DateTimeOriginal and GPS) grafted
 * back in, as `resizeImage` does.
 */
export const createBrowserResizedJpeg = async (): Promise<Uint8Array> => {
  const source = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#a0a0a0' }
  })
    .jpeg()
    .withExif({
      IFD0: { Make: 'LeakyCam', Model: 'Model X' },
      IFD2: { DateTimeOriginal: '2024:05:06 07:08:09' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '52/1 31/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '13/1 24/1 0/1'
      }
    })
    .toBuffer()
  const canvasOutput = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#a0a0a0' }
  })
    .jpeg()
    .toBuffer()
  const segment = extractJpegExifSegment(new Uint8Array(source))
  if (!segment) throw new Error('fixture source has no Exif segment')
  return insertJpegExifSegment(new Uint8Array(canvasOutput), segment)
}
