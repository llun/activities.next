import sharp from 'sharp'

import { MAX_HEIGHT, MAX_WIDTH } from './constants'
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
  it('fits an image above the box inside it', async () => {
    const input = await createJpeg(MAX_WIDTH + 200, (MAX_HEIGHT + 200) / 2)

    await expect(pipelineSize(input)).resolves.toEqual({
      width: MAX_WIDTH,
      height: MAX_HEIGHT / 2
    })
  })

  it('does not enlarge an image below the box', async () => {
    // `fit: 'inside'` enlarges by default; the pipeline must stay a cap.
    const input = await createJpeg(800, 600)

    await expect(pipelineSize(input)).resolves.toEqual({
      width: 800,
      height: 600
    })
  })

  it('applies the EXIF orientation', async () => {
    // Orientation 6 stores a 200x100 image that displays 100 wide, 200 high.
    const input = await createJpeg(200, 100, 6)

    await expect(pipelineSize(input)).resolves.toEqual({
      width: 100,
      height: 200
    })
  })
})
