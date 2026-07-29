import sharp from 'sharp'

import { MediaValidationError } from './errors'
import { readValidThumbnail } from './thumbnailInput'

const createPng = async (width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .png()
    .toBuffer()

const asFile = (bytes: Uint8Array, type = 'image/png', name = 'thumb.png') =>
  new File([bytes], name, { type })

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
})
