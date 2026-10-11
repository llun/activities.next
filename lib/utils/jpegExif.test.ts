import sharp, { type Sharp } from 'sharp'

import { readMediaExif } from '@/lib/services/medias/exif/readMediaExif'
import {
  extractJpegExifSegment,
  insertJpegExifSegment
} from '@/lib/utils/jpegExif'

const createJpeg = (exif?: Parameters<Sharp['withExif']>[0]) => {
  const image = sharp({
    create: { width: 8, height: 8, channels: 3, background: '#808080' }
  }).jpeg()
  return (exif ? image.withExif(exif) : image).toBuffer()
}

const exif = {
  IFD0: { Make: 'Canon', Model: 'Canon EOS R5' },
  IFD2: { DateTimeOriginal: '2024:05:06 07:08:09' },
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '51/1 30/1 0/1',
    GPSLongitudeRef: 'W',
    GPSLongitude: '0/1 7/1 30/1'
  }
}

// Minimal hand-built Exif APP1 with a single Orientation entry.
const buildExifJpeg = (little: boolean, orientation: number) => {
  const tiff = new Uint8Array(8 + 2 + 12 + 4)
  const view = new DataView(tiff.buffer)
  tiff.set([little ? 0x49 : 0x4d, little ? 0x49 : 0x4d])
  view.setUint16(2, 42, little)
  view.setUint32(4, 8, little)
  view.setUint16(8, 1, little)
  view.setUint16(10, 0x0112, little)
  view.setUint16(12, 3, little)
  view.setUint32(14, 1, little)
  view.setUint16(18, orientation, little)
  const payload = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff])
  const length = payload.length + 2
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    length >> 8,
    length & 0xff,
    ...payload,
    0xff,
    0xd9
  ])
}

const orientationOf = (segment: Uint8Array, little: boolean) =>
  new DataView(segment.buffer, segment.byteOffset).getUint16(
    4 + 6 + 8 + 2 + 8,
    little
  )

describe('extractJpegExifSegment', () => {
  it('returns the Exif APP1 segment of a JPEG', async () => {
    const segment = extractJpegExifSegment(await createJpeg(exif))

    expect(segment).not.toBeNull()
    expect(Array.from(segment!.slice(0, 2))).toEqual([0xff, 0xe1])
    expect(String.fromCharCode(...segment!.slice(4, 8))).toBe('Exif')
    expect(((segment![2] << 8) | segment![3]) + 2).toBe(segment!.length)
  })

  it('accepts an ArrayBuffer', async () => {
    const buffer = await createJpeg(exif)
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer
    expect(extractJpegExifSegment(arrayBuffer)).not.toBeNull()
  })

  it('returns null without Exif, for a PNG, garbage and empty input', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#fff' }
    })
      .png()
      .toBuffer()
    expect(extractJpegExifSegment(await createJpeg())).toBeNull()
    expect(extractJpegExifSegment(png)).toBeNull()
    expect(extractJpegExifSegment(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull()
    expect(extractJpegExifSegment(new Uint8Array())).toBeNull()
  })

  it('returns null for truncated data', async () => {
    const jpeg = await createJpeg(exif)
    expect(extractJpegExifSegment(jpeg.subarray(0, 20))).toBeNull()
    expect(extractJpegExifSegment(jpeg.subarray(0, 3))).toBeNull()
  })

  it('does not modify the input', async () => {
    const jpeg = new Uint8Array(await createJpeg(exif))
    const copy = jpeg.slice()
    extractJpegExifSegment(jpeg)
    expect(jpeg).toEqual(copy)
  })

  it.each([true, false])(
    'resets Orientation to 1 (little endian: %s)',
    (little) => {
      const segment = extractJpegExifSegment(buildExifJpeg(little, 6))!
      expect(orientationOf(segment, little)).toBe(1)
    }
  )

  it('returns the segment unchanged when there is no Orientation tag', () => {
    const jpeg = buildExifJpeg(true, 6)
    // Make the entry a different tag (0x0113).
    jpeg[4 + 2 + 6 + 8 + 2] = 0x13
    const segment = extractJpegExifSegment(jpeg)
    expect(segment).not.toBeNull()
    expect(orientationOf(segment!, true)).toBe(6)
  })

  it('returns null for an invalid TIFF header', () => {
    const jpeg = buildExifJpeg(true, 6)
    jpeg[4 + 2 + 6] = 0x00
    expect(extractJpegExifSegment(jpeg)).toBeNull()
  })

  it('resets the Orientation sharp wrote', async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#808080' }
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    expect((await sharp(jpeg).metadata()).orientation).toBe(6)
    const segment = extractJpegExifSegment(jpeg)!
    const rebuilt = insertJpegExifSegment(
      new Uint8Array(await createJpeg()),
      segment
    )
    expect((await sharp(rebuilt).metadata()).orientation).toBe(1)
  })
})

describe('extractJpegExifSegment header scanning', () => {
  it('finds Exif after fill bytes, XMP APP1 and a DQT segment', () => {
    const exifSegment = extractJpegExifSegment(buildExifJpeg(true, 6))!
    const xmpPayload = Array.from(
      new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0<x/>')
    )
    const xmpLength = xmpPayload.length + 2
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xff,
      0xff,
      0xe1,
      xmpLength >> 8,
      xmpLength & 0xff,
      ...xmpPayload,
      0xff,
      0xdb,
      0x00,
      0x04,
      0x00,
      0x01,
      0xff,
      0xff,
      ...exifSegment,
      0xff,
      0xd9
    ])

    const found = extractJpegExifSegment(jpeg)

    expect(found).not.toBeNull()
    expect(String.fromCharCode(...found!.slice(4, 8))).toBe('Exif')
    expect(orientationOf(found!, true)).toBe(1)
  })
})

describe('insertJpegExifSegment', () => {
  it('produces a JPEG whose EXIF the server reader and sharp understand', async () => {
    const segment = extractJpegExifSegment(await createJpeg(exif))!
    const plain = new Uint8Array(await createJpeg())

    const merged = insertJpegExifSegment(plain, segment)

    const read = await readMediaExif(Buffer.from(merged))
    expect(read).toMatchObject({
      latitude: 51.5,
      longitude: -0.125,
      make: 'Canon',
      model: 'Canon EOS R5',
      takenAt: new Date('2024-05-06T07:08:09.000Z')
    })
    const metadata = await sharp(merged).metadata()
    expect(metadata.orientation ?? 1).toBe(1)
    expect(metadata.width).toBe(8)
    await expect(sharp(merged).raw().toBuffer()).resolves.toBeDefined()
  })

  it('replaces an Exif segment the target already has', async () => {
    const segment = extractJpegExifSegment(await createJpeg(exif))!
    const target = new Uint8Array(await createJpeg({ IFD0: { Make: 'Other' } }))

    const merged = insertJpegExifSegment(target, segment)

    expect(merged.length).toBe(
      target.length - extractJpegExifSegment(target)!.length + segment.length
    )
    expect((await readMediaExif(Buffer.from(merged))).make).toBe('Canon')
  })

  const markersOf = (bytes: Uint8Array) => {
    const markers: number[] = []
    let offset = 2
    while (offset + 4 <= bytes.length && bytes[offset + 1] !== 0xda) {
      markers.push(bytes[offset + 1])
      offset += 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3])
    }
    return markers
  }

  // sharp may or may not write a JFIF APP0, so build the JFIF layout by hand.
  const JFIF_APP0 = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00
  ]
  const withJfif = (jpeg: Uint8Array) =>
    new Uint8Array([...jpeg.slice(0, 2), ...JFIF_APP0, ...jpeg.slice(2)])

  it('inserts after a leading JFIF APP0', async () => {
    const segment = extractJpegExifSegment(await createJpeg(exif))!
    const target = withJfif(new Uint8Array(await createJpeg()))
    expect(markersOf(target)[0]).toBe(0xe0)

    const merged = insertJpegExifSegment(target, segment)

    expect(markersOf(merged).slice(0, 2)).toEqual([0xe0, 0xe1])
    expect((await readMediaExif(Buffer.from(merged))).latitude).toBe(51.5)
  })

  it('inserts right after SOI when there is no JFIF APP0', async () => {
    const segment = extractJpegExifSegment(await createJpeg(exif))!
    const target = new Uint8Array(await createJpeg())
    expect(markersOf(target)[0]).not.toBe(0xe0)

    const merged = insertJpegExifSegment(target, segment)

    expect(markersOf(merged)[0]).toBe(0xe1)
    expect((await readMediaExif(Buffer.from(merged))).latitude).toBe(51.5)
  })

  it('keeps JFIF first when replacing an existing Exif segment', async () => {
    const segment = extractJpegExifSegment(await createJpeg(exif))!
    const target = withJfif(
      new Uint8Array(await createJpeg({ IFD0: { Make: 'Other' } }))
    )

    const merged = insertJpegExifSegment(target, segment)

    expect(markersOf(merged).filter((m) => m === 0xe1)).toHaveLength(1)
    expect(markersOf(merged).slice(0, 2)).toEqual([0xe0, 0xe1])
    expect((await readMediaExif(Buffer.from(merged))).make).toBe('Canon')
  })

  it('returns non-JPEG input unchanged', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(insertJpegExifSegment(bytes, new Uint8Array([0xff, 0xe1]))).toBe(
      bytes
    )
  })
})
