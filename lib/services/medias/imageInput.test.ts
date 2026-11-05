import { MediaValidationError } from './errors'
import { readUploadImageMetadata } from './imageInput'
import { createStoredImagePipeline } from './storedImagePipeline'
import { uploadImageFixture } from './uploadImage.fixture'

vi.mock('./constants', async (importActual) => ({
  ...(await importActual<typeof import('./constants')>()),
  MAX_IMAGE_INPUT_PIXELS: 64
}))

describe('upload image pixel budget', () => {
  it.each(['webp', 'gif', 'avif'] as const)(
    'accepts a small real %s',
    async (format) => {
      await expect(
        readUploadImageMetadata(
          await uploadImageFixture(format),
          `image/${format}`
        )
      ).resolves.toMatchObject({ width: 8, height: 6 })
    }
  )

  it.each(['gif', 'webp'] as const)(
    'counts all %s frames before decoding',
    async (format) => {
      const bytes = await uploadImageFixture(format, { animated: true })
      // Each frame is 48 pixels, below 64; two frames together exceed the budget.
      await expect(
        readUploadImageMetadata(bytes, `image/${format}`)
      ).rejects.toBeInstanceOf(MediaValidationError)
      await expect(
        createStoredImagePipeline(bytes, true).webp().toBuffer()
      ).rejects.toThrow()
    }
  )

  it('rejects HEIC even when the claimed bytes are a valid AVIF', async () => {
    await expect(
      readUploadImageMetadata(await uploadImageFixture('avif'), 'image/heic')
    ).rejects.toBeInstanceOf(MediaValidationError)
  })
})
