import sharp from 'sharp'

import { MediaValidationError } from './errors'
import { createStoredImagePipeline } from './storedImagePipeline'
import { readValidThumbnail } from './thumbnailInput'

const createPng = async (width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .png()
    .toBuffer()

// Noise, so the JPEG is large and every scanline carries data worth skipping.
const createNoisyJpeg = (width: number, height: number) => {
  const pixels = Buffer.alloc(width * height * 3)
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = Math.imul(index, 2654435761) >>> 24
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 80 })
    .toBuffer()
}

const asFile = (bytes: Uint8Array, type = 'image/png', name = 'thumb.png') =>
  new File([bytes as unknown as BlobPart], name, { type })

describe('readValidThumbnail', () => {
  it('returns the bytes of a real image', async () => {
    const png = await createPng()

    await expect(readValidThumbnail(asFile(png))).resolves.toEqual(png)
  })

  it.each([
    {
      // Real image bytes, declared as a video. Only the declared-type guard
      // rejects this — the decode below is perfectly happy with it — and it is
      // the check that keeps `saveFile` consistent with `saveThumbnail`, which
      // refuses a non-image type outright.
      description: 'rejects a declared type that is not an image',
      file: async () =>
        new File([await createPng()], 'clip.mp4', { type: 'video/mp4' })
    },
    {
      description: 'rejects bytes that are not an image at all',
      file: () => asFile(Buffer.from('not-an-image'))
    },
    {
      description: 'rejects an empty file',
      file: () => asFile(Buffer.alloc(0))
    },
    {
      description: 'rejects an image whose body is truncated',
      file: async () => {
        // The case a header parse cannot catch: `sharp().metadata()` reports
        // 400x300 for this, and only the full decode rejects it. Without that,
        // the encoder is the first thing to notice — by which point the
        // original is stored and the failure looks like ours.
        const png = await createPng(400, 300)
        return asFile(png.subarray(0, Math.floor(png.length * 0.6)))
      }
    }
  ])('$description', async ({ file }) => {
    await expect(readValidThumbnail(await file())).rejects.toThrow(
      MediaValidationError
    )
  })

  it('refuses a tall JPEG truncated near its end, as the encode does', async () => {
    // Any validator that decodes every row rejects it, as the encode does; one
    // that shrinks hard on load, such as `resize(1, 1)`, does not. The numbers
    // are load-bearing: at 8001 rows a shrink-by-8 decode never needs the last
    // MCU row, which holds only source row 8001. An 8000-row image, or a cut of
    // 5000+ bytes, would make even `resize(1, 1)` reject.
    const jpeg = await createNoisyJpeg(1000, 8001)
    const truncated = jpeg.subarray(0, jpeg.length - 1000)

    // Each promise is collapsed to its outcome first: a wrongly resolved
    // promise would otherwise print its whole decoded Buffer into the failure.
    const encoded = await createStoredImagePipeline(truncated)
      .webp()
      .toBuffer()
      .then(
        () => 'encoded',
        (error: unknown) => error
      )
    const validated = await readValidThumbnail(
      asFile(truncated, 'image/jpeg', 'thumb.jpg')
    ).then(
      () => 'accepted',
      (error: unknown) => error
    )

    expect(encoded).toBeInstanceOf(Error)
    expect(validated).toBeInstanceOf(MediaValidationError)
  })

  it('decides each image on its own bytes when many are validated at once', async () => {
    // sharp reports a libvips failure through one process-wide error buffer,
    // which every sharp call clears as it finishes. One at a time, a truncated
    // image is refused every time; alongside other sharp calls, a check whose
    // message was cleared first can resolve as though the image had decoded.
    // `stats()` let several of the 128 truncated inputs through on every run,
    // so a check exposed to that race fails here on practically every run.
    const png = await createPng(400, 300)
    const truncated = png.subarray(0, Math.floor(png.length * 0.6))
    const isTruncated = Array.from(
      { length: 256 },
      (_, index) => index % 2 === 0
    )

    const results = await Promise.allSettled(
      isTruncated.map((truncate) =>
        readValidThumbnail(asFile(truncate ? truncated : png))
      )
    )

    const outcomes = results.map((result) =>
      result.status === 'fulfilled'
        ? 'accepted'
        : result.reason instanceof MediaValidationError
          ? 'refused'
          : 'failed'
    )
    const expected = isTruncated.map((truncate) =>
      truncate ? 'refused' : 'accepted'
    )

    // Lists only the mismatches, so a regression names the input it misjudged.
    expect(
      outcomes.flatMap((outcome, index) =>
        outcome === expected[index]
          ? []
          : [`#${index}: ${outcome}, expected ${expected[index]}`]
      )
    ).toEqual([])
  })
})
