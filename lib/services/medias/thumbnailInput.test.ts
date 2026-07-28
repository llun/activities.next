import sharp from 'sharp'

import { MediaValidationError } from './errors'
import {
  assertReadableThumbnail,
  assertThumbnailDecodable
} from './thumbnailInput'

const createPng = async (width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .png()
    .toBuffer()

const asFile = (bytes: Uint8Array, type = 'image/png', name = 'thumb.png') =>
  new File([bytes], name, { type })

describe('assertReadableThumbnail', () => {
  it('accepts a real image', async () => {
    await expect(
      assertReadableThumbnail(asFile(await createPng()))
    ).resolves.toBeUndefined()
  })

  it.each([
    {
      description: 'rejects a declared type that is not an image',
      file: () =>
        new File([Buffer.from('video-bytes')], 'clip.mp4', {
          type: 'video/mp4'
        })
    },
    {
      description: 'rejects bytes that are not an image at all',
      file: () => asFile(Buffer.from('not-an-image'))
    },
    {
      description: 'rejects an empty file',
      file: () => asFile(Buffer.alloc(0))
    }
  ])('$description', async ({ file }) => {
    await expect(assertReadableThumbnail(file())).rejects.toThrow(
      MediaValidationError
    )
  })

  // The reason `assertThumbnailDecodable` has to exist: this check reads the
  // header, so an image whose body was cut short passes it and only fails later,
  // in the encoder. Anything that changes this to a full decode should delete
  // the second function rather than leave both.
  it('accepts a truncated image, which only a full decode catches', async () => {
    const png = await createPng(400, 300)
    const truncated = asFile(png.subarray(0, Math.floor(png.length * 0.6)))

    await expect(assertReadableThumbnail(truncated)).resolves.toBeUndefined()
    await expect(assertThumbnailDecodable(truncated)).rejects.toThrow(
      MediaValidationError
    )
  })
})

describe('assertThumbnailDecodable', () => {
  it('accepts a real image', async () => {
    await expect(
      assertThumbnailDecodable(asFile(await createPng()))
    ).resolves.toBeUndefined()
  })

  // It classifies bytes, so it must not care about the declared type — the
  // caller has already decided whether that mattered.
  it('accepts a real image regardless of the declared type', async () => {
    await expect(
      assertThumbnailDecodable(
        asFile(await createPng(), 'image/jpeg', 'mislabelled.jpg')
      )
    ).resolves.toBeUndefined()
  })
})
