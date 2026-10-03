import sharp from 'sharp'

import { createStoredImagePipeline } from './storedImagePipeline'

const createJpeg = (width: number, height: number, orientation?: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .jpeg()
    .withMetadata(orientation ? { orientation } : {})
    .toBuffer()

// What the encode would hand its encoder: the pixels after the resize and the
// orientation have been applied.
const pipelineSize = async (input: Buffer) => {
  const { info } = await createStoredImagePipeline(input)
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height }
}

describe('createStoredImagePipeline', () => {
  it('applies the EXIF orientation', async () => {
    // Orientation 6 stores a 200x100 image that displays 100 wide, 200 high.
    const input = await createJpeg(200, 100, 6)

    await expect(pipelineSize(input)).resolves.toEqual({
      width: 100,
      height: 200
    })
  })
})
