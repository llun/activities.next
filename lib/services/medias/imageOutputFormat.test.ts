import sharp from 'sharp'

import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  type ImageOutputFormat,
  encodeImageOutput,
  getImageOutputFormatDetail
} from './imageOutputFormat'

// Deterministic non-uniform content. A solid fill is useless here: the encoders
// produce identical bytes for it whatever quality is asked for, so a byte
// comparison against a solid image pins nothing.
const WIDTH = 64
const HEIGHT = 48

const createImage = () => {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 3
      // Pale background with a saturated diagonal line through it — the shape a
      // route map actually has.
      const onRoute = Math.abs(x - y * 1.3) < 2
      pixels[offset] = onRoute ? 255 : 232 - ((x * 7 + y * 13) % 24)
      pixels[offset + 1] = onRoute ? 59 : 228 - ((x * 11 + y * 5) % 24)
      pixels[offset + 2] = onRoute ? 48 : 221 - ((x * 3 + y * 17) % 24)
    }
  }
  return sharp(pixels, {
    raw: { width: WIDTH, height: HEIGHT, channels: 3 }
  })
}

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

  // Guards the guard: if the fixture were flat, the comparison above would hold
  // for any quality and pin nothing. `nearLossless` is covered by the byte
  // comparison; `smartSubsample` is deliberately not asserted because
  // near-lossless puts libwebp in lossless mode, where chroma subsampling never
  // applies — it is carried only because the pre-existing encoders passed it.
  it('has a fixture that actually reacts to webp quality', async () => {
    const [high, low] = await Promise.all([
      createImage()
        .webp({ quality: 95, smartSubsample: true, nearLossless: true })
        .toBuffer(),
      createImage()
        .webp({ quality: 20, smartSubsample: true, nearLossless: true })
        .toBuffer()
    ])

    expect(high.equals(low)).toBe(false)
  })
})
