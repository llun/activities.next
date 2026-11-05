import sharp from 'sharp'

import { MAX_AVIF_INPUT_PIXELS, MAX_IMAGE_INPUT_PIXELS } from './constants'
import { MediaValidationError } from './errors'
import { readUploadImageMetadata } from './imageInput'

// Both caps are shrunk so the case that sits between them (above the AVIF cap,
// inside the shared budget) is a tiny image rather than a slow 48 MP encode.
vi.mock('./constants', async (importActual) => ({
  ...(await importActual<typeof import('./constants')>()),
  MAX_AVIF_INPUT_PIXELS: 64,
  MAX_IMAGE_INPUT_PIXELS: 10_000
}))

describe('AVIF input pixel cap', () => {
  it('refuses a single AVIF frame above the AVIF cap but inside the shared budget', async () => {
    const width = 20
    const height = 10
    expect(width * height).toBeGreaterThan(MAX_AVIF_INPUT_PIXELS)
    expect(width * height).toBeLessThanOrEqual(MAX_IMAGE_INPUT_PIXELS)

    const avif = await sharp({
      create: { width, height, channels: 3, background: '#3366cc' }
    })
      .avif({ quality: 50 })
      .toBuffer()

    await expect(
      readUploadImageMetadata(avif, 'image/avif')
    ).rejects.toBeInstanceOf(MediaValidationError)
    await expect(readUploadImageMetadata(avif, 'image/avif')).rejects.toThrow(
      'AVIF'
    )
  })

  it('accepts a WebP of the same size, which only the shared budget limits', async () => {
    const webp = await sharp({
      create: { width: 20, height: 10, channels: 3, background: '#3366cc' }
    })
      .webp()
      .toBuffer()

    await expect(
      readUploadImageMetadata(webp, 'image/webp')
    ).resolves.toBeDefined()
  })
})
