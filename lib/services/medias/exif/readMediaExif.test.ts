import sharp, { type Sharp } from 'sharp'

import {
  EMPTY_MEDIA_EXIF,
  formatExposureTime,
  readMediaExif,
  toTakenAt
} from '@/lib/services/medias/exif/readMediaExif'
import { withTimeZone } from '@/lib/testing/withTimeZone'

type ExifInput = NonNullable<Parameters<Sharp['withExif']>[0]>

// A real JPEG carrying real EXIF blocks, built the way a camera would write
// them, so the reader is exercised against bytes rather than a mocked parser.
const createJpeg = async (exif?: ExifInput) => {
  const image = sharp({
    create: { width: 8, height: 8, channels: 3, background: '#808080' }
  }).jpeg()
  return (exif ? image.withExif(exif) : image).toBuffer()
}

const fullExif: ExifInput = {
  IFD0: { Make: 'Canon', Model: 'Canon EOS R5' },
  IFD2: {
    DateTimeOriginal: '2024:05:06 07:08:09',
    ExposureTime: '1/2000',
    FNumber: '28/10',
    ISOSpeedRatings: '400',
    FocalLength: '400/1',
    LensModel: 'RF100-500mm F4.5-7.1 L IS USM'
  },
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '51/1 30/1 0/1',
    GPSLongitudeRef: 'W',
    GPSLongitude: '0/1 7/1 30/1'
  }
}

describe('readMediaExif', () => {
  it('reads the date, gear, exposure and GPS a camera wrote', async () => {
    const exif = await readMediaExif(await createJpeg(fullExif))

    expect(exif).toEqual({
      takenAt: new Date('2024-05-06T07:08:09.000Z'),
      make: 'Canon',
      model: 'Canon EOS R5',
      lensModel: 'RF100-500mm F4.5-7.1 L IS USM',
      focalLengthMm: 400,
      aperture: 2.8,
      exposureTime: '1/2000',
      iso: 400,
      latitude: 51.5,
      longitude: -0.125
    })
  })

  it('applies the recorded UTC offset to the wall-clock date', async () => {
    const exif = await readMediaExif(
      await createJpeg({
        IFD2: {
          DateTimeOriginal: '2024:05:06 09:00:00',
          OffsetTimeOriginal: '+02:00'
        }
      })
    )

    expect(exif.takenAt).toEqual(new Date('2024-05-06T07:00:00.000Z'))
  })

  // exifr builds the date in the process's local timezone; the stored instant
  // must not depend on it. vitest pins TZ to UTC, so the zone is switched here.
  describe.each([
    'UTC',
    'Asia/Bangkok',
    'America/Los_Angeles',
    'Pacific/Auckland'
  ])('in the %s timezone', (zone) => {
    it('reads the wall-clock date as UTC', () =>
      withTimeZone(zone, async () => {
        const exif = await readMediaExif(await createJpeg(fullExif))
        expect(exif.takenAt).toEqual(new Date('2024-05-06T07:08:09.000Z'))
      }))

    it('applies the recorded offset to the wall-clock date', () =>
      withTimeZone(zone, async () => {
        const exif = await readMediaExif(
          await createJpeg({
            IFD2: {
              DateTimeOriginal: '2024:05:06 09:00:00',
              OffsetTimeOriginal: '+02:00'
            }
          })
        )
        expect(exif.takenAt).toEqual(new Date('2024-05-06T07:00:00.000Z'))
      }))

    it('converts a Date built from local fields', () =>
      withTimeZone(zone, () => {
        expect(toTakenAt(new Date(2024, 4, 6, 7, 8, 9), undefined)).toEqual(
          new Date('2024-05-06T07:08:09.000Z')
        )
      }))
  })

  it('returns nulls for an image with no EXIF', async () => {
    expect(await readMediaExif(await createJpeg())).toEqual(EMPTY_MEDIA_EXIF)
  })

  it('returns only the fields that are present', async () => {
    const exif = await readMediaExif(
      await createJpeg({ IFD0: { Make: 'Nikon', Model: 'Z 9' } })
    )

    expect(exif).toEqual({
      ...EMPTY_MEDIA_EXIF,
      make: 'Nikon',
      model: 'Z 9'
    })
  })

  it.each([
    ['not an image', Buffer.from('definitely not an image')],
    ['empty', Buffer.alloc(0)],
    ['a truncated JPEG header', Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00])]
  ])(
    'never throws and returns nulls for input that is %s',
    async (_, input) => {
      await expect(readMediaExif(input)).resolves.toEqual(EMPTY_MEDIA_EXIF)
    }
  )

  it.each([
    ['null island', 0, 0],
    ['a latitude past the pole', 91, 10]
  ])('drops coordinates that are %s', async (_, latitude, longitude) => {
    const exif = await readMediaExif(
      await createJpeg({
        IFD3: {
          GPSLatitudeRef: latitude < 0 ? 'S' : 'N',
          GPSLatitude: `${Math.abs(latitude)}/1 0/1 0/1`,
          GPSLongitudeRef: 'E',
          GPSLongitude: `${longitude}/1 0/1 0/1`
        }
      })
    )

    expect(exif.latitude).toBeNull()
    expect(exif.longitude).toBeNull()
  })

  it('trims the text fields cameras pad', async () => {
    const exif = await readMediaExif(
      await createJpeg({ IFD0: { Make: '  SONY  ', Model: 'ILCE-7M4 ' } })
    )

    expect(exif.make).toBe('SONY')
    expect(exif.model).toBe('ILCE-7M4')
  })
})

describe('formatExposureTime', () => {
  it.each([
    [0.0005, '1/2000'],
    [1 / 60, '1/60'],
    [0.5, '1/2'],
    // Not close to any reciprocal, so the decimal is shown.
    [0.4, '0.4'],
    [1, '1'],
    [2.5, '2.5'],
    [30, '30']
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(formatExposureTime(seconds)).toBe(expected)
  })

  it.each([[0], [-1], [NaN], [Infinity], ['1/2000'], [null], [undefined]])(
    'returns null for %j',
    (value) => {
      expect(formatExposureTime(value)).toBeNull()
    }
  )
})
