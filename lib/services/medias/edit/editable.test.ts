import { isEditableMedia } from '@/lib/services/medias/edit/editable'
import { MAX_SOURCE_PIXELS } from '@/lib/services/medias/edit/recipe'
import { readEditSource } from '@/lib/services/medias/edit/saveMediaEdit'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { uploadImageFixture } from '@/lib/services/medias/uploadImage.fixture'

vi.mock('@/lib/services/medias/readStoredMedia', () => ({
  readStoredImage: vi.fn()
}))

const media = (
  mimeType: string,
  metaData: Record<string, unknown> = { width: 4000, height: 3000 }
) => ({
  original: {
    path: 'a',
    bytes: 1,
    mimeType,
    metaData: metaData as { width: number; height: number }
  }
})

describe('isEditableMedia', () => {
  it.each([
    ['a JPEG', media('image/jpeg'), true],
    ['a PNG', media('image/png'), true],
    ['a WebP (an edited photo)', media('image/webp'), true],
    [
      'an animated WebP',
      media('image/webp', { width: 8, height: 6, pages: 2 }),
      false
    ],
    ['a still GIF (stored as WebP)', media('image/gif'), true],
    ['a still AVIF (stored as WebP)', media('image/avif'), true],
    [
      'an animated GIF',
      media('image/gif', { width: 8, height: 6, pages: 3 }),
      false
    ],
    ['a video', media('video/mp4'), false],
    ['audio', media('audio/mp4'), false],
    [
      'a pending presigned upload',
      media('image/jpeg', {
        width: 10,
        height: 10,
        upload: { state: 'pending' }
      }),
      false
    ],
    [
      'a verified presigned upload',
      media('image/jpeg', {
        width: 10,
        height: 10,
        upload: { state: 'verified' }
      }),
      true
    ],
    [
      'a photo at the pixel cap',
      media('image/jpeg', { width: MAX_SOURCE_PIXELS / 1000, height: 1000 }),
      true
    ],
    [
      'a photo over the pixel cap',
      media('image/jpeg', {
        width: MAX_SOURCE_PIXELS / 1000 + 1,
        height: 1000
      }),
      false
    ]
  ])('%s is editable: %s', (_, value, expected) => {
    expect(isEditableMedia(value)).toBe(expected)
  })
})

describe('readEditSource', () => {
  it('refuses an animated WebP source even if decoded directly', async () => {
    const animated = await uploadImageFixture('webp', { animated: true })
    vi.mocked(readStoredImage).mockResolvedValueOnce({
      buffer: animated,
      mimeType: 'image/webp'
    })

    expect(await readEditSource({} as never, 'medias/anim.webp')).toBeNull()
  })
})
