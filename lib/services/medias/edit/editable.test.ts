import { isEditableMedia } from '@/lib/services/medias/edit/editable'
import { MAX_SOURCE_PIXELS } from '@/lib/services/medias/edit/recipe'

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
    ['a GIF', media('image/gif'), false],
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
