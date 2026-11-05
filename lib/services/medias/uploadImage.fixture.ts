import sharp from 'sharp'

export const uploadImageFixture = async (
  format: 'png' | 'webp' | 'gif' | 'avif',
  { animated = false, exif = false, width = 8, height = 6 } = {}
) => {
  const input = animated
    ? sharp(
        Buffer.concat([
          Buffer.alloc(width * height * 3, 0),
          Buffer.alloc(width * height * 3, 255)
        ]),
        {
          raw: { width, height: height * 2, channels: 3, pageHeight: height }
        }
      )
    : sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
  if (exif)
    input.withExif({
      IFD0: { Make: 'Camera', Orientation: '6' },
      IFD2: { DateTimeOriginal: '2024:05:06 07:08:09' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 30/1'
      }
    })
  if (exif) input.withMetadata({ orientation: 6 })
  if (format === 'gif')
    return input.gif({ delay: [100, 200], loop: 0 }).toBuffer()
  if (format === 'webp')
    return input.webp({ delay: [100, 200], loop: 0 }).toBuffer()
  return input.toFormat(format).toBuffer()
}
