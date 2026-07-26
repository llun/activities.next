import sharp from 'sharp'

import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  type ImageOutputFormat,
  encodeImageOutput,
  getImageOutputFormatDetail
} from './imageOutputFormat'

const createImage = () =>
  sharp({
    create: {
      width: 8,
      height: 6,
      channels: 3,
      background: { r: 255, g: 59, b: 48 }
    }
  })

describe('getImageOutputFormatDetail', () => {
  it.each([
    {
      description: 'webp writes .webp as image/webp',
      format: 'webp' as ImageOutputFormat,
      extension: 'webp',
      contentType: 'image/webp'
    },
    {
      description: 'jpeg writes .jpg as image/jpeg',
      format: 'jpeg' as ImageOutputFormat,
      extension: 'jpg',
      contentType: 'image/jpeg'
    }
  ])('$description', ({ format, extension, contentType }) => {
    expect(getImageOutputFormatDetail(format)).toEqual({
      extension,
      contentType
    })
  })
})

describe('encodeImageOutput', () => {
  it('defaults to webp so existing uploads are unchanged', () => {
    expect(DEFAULT_IMAGE_OUTPUT_FORMAT).toBe('webp')
  })

  it.each([
    { description: 'encodes webp output', format: 'webp' as ImageOutputFormat },
    { description: 'encodes jpeg output', format: 'jpeg' as ImageOutputFormat }
  ])('$description', async ({ format }) => {
    const buffer = await encodeImageOutput(createImage(), format).toBuffer()

    const metadata = await sharp(buffer).metadata()
    expect(metadata.format).toBe(format)
  })

  it('encodes jpeg as baseline, not progressive, for Outlook', async () => {
    const buffer = await encodeImageOutput(createImage(), 'jpeg').toBuffer()

    const metadata = await sharp(buffer).metadata()
    expect(metadata.isProgressive).toBe(false)
  })

  it('encodes jpeg without chroma subsampling', async () => {
    const buffer = await encodeImageOutput(createImage(), 'jpeg').toBuffer()

    // A route map is a saturated thin polyline over pale tiles, which is
    // exactly what chroma subsampling smears.
    const metadata = await sharp(buffer).metadata()
    expect(metadata.chromaSubsampling).toBe('4:4:4')
  })

  // Every image the storages wrote before the format option existed was encoded
  // with these exact options. Pinning them by output bytes is what stops the
  // shared helper from silently re-encoding every upload in the product.
  it('encodes webp with the settings every existing upload was stored with', async () => {
    const [encoded, expected] = await Promise.all([
      encodeImageOutput(createImage(), 'webp').toBuffer(),
      createImage()
        .webp({ quality: 95, smartSubsample: true, nearLossless: true })
        .toBuffer()
    ])

    expect(encoded.equals(expected)).toBe(true)
  })
})
