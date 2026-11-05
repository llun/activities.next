import { computeBlurhash, computeSmartFocus } from './imageAnalysis'
import { uploadImageFixture } from './uploadImage.fixture'

// A tiny cap so a real 8x6 fixture is over it: the point is that the sharp
// call refuses the input before decoding, not that the fixture is large.
vi.mock('./constants', async (importActual) => ({
  ...(await importActual<typeof import('./constants')>()),
  MAX_IMAGE_INPUT_PIXELS: 10
}))

describe('image analysis input pixel limit', () => {
  it.each([
    ['blurhash', computeBlurhash],
    ['smart focus', computeSmartFocus]
  ])(
    'refuses an image above the limit before decoding (%s)',
    async (_, analyse) => {
      // 8x6 = 48 pixels, over the mocked cap of 10.
      await expect(analyse(await uploadImageFixture('png'))).resolves.toBeNull()
    }
  )

  it.each([
    ['blurhash', computeBlurhash],
    ['smart focus', computeSmartFocus]
  ])('still analyses an image inside the limit (%s)', async (_, analyse) => {
    // 2x2 = 4 pixels.
    await expect(
      analyse(await uploadImageFixture('png', { width: 2, height: 2 }))
    ).resolves.not.toBeNull()
  })
})
