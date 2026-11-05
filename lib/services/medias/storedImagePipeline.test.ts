import sharp from 'sharp'

import { createStoredImagePipeline } from './storedImagePipeline'
import { uploadImageFixture } from './uploadImage.fixture'

const createJpeg = (width: number, height: number, orientation: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .jpeg()
    .withMetadata({ orientation })
    .toBuffer()

describe('createStoredImagePipeline', () => {
  it.each(['gif', 'webp'] as const)(
    'resizes all %s frames without stacking their displayed height',
    async (format) => {
      const bytes = await uploadImageFixture(format, {
        animated: true,
        width: 5000,
        height: 10
      })
      const output = await createStoredImagePipeline(bytes, true)
        .webp()
        .toBuffer()
      expect(await sharp(output).metadata()).toMatchObject({
        width: 4000,
        height: 8,
        pages: 2,
        loop: 0,
        delay: [100, 200]
      })
    }
  )

  it('applies the EXIF orientation', async () => {
    // Orientation 6 stores a 200x100 image that displays 100 wide, 200 high.
    const input = await createJpeg(200, 100, 6)

    // What the encode would hand its encoder: the pixels after the resize and
    // the orientation have been applied.
    const { info } = await createStoredImagePipeline(input)
      .raw()
      .toBuffer({ resolveWithObject: true })

    expect({ width: info.width, height: info.height }).toEqual({
      width: 100,
      height: 200
    })
  })
})
