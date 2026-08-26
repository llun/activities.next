import { Attachment } from '@/lib/types/domain/attachment'
import {
  getDocumentFromAttachment,
  getMastodonAttachment,
  isAudibleAttachment,
  isFitnessAttachment,
  isRenderableAttachment,
  isVisualAttachment
} from '@/lib/types/domain/attachment'

describe('attachment', () => {
  const baseAttachment: Attachment = {
    id: 'attachment-123',
    actorId: 'https://example.com/users/test',
    statusId: 'https://example.com/statuses/456',
    type: 'Document',
    mediaType: 'image/jpeg',
    url: 'https://example.com/media/image.jpg',
    width: 1920,
    height: 1080,
    name: 'Test image',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  // `getMastodonAttachment` answers a union, and the `unknown` member carries no
  // `meta` — so reach for it through a narrowing check rather than an optional
  // chain the compiler cannot follow.
  const metaOf = (attachment: ReturnType<typeof getMastodonAttachment>) =>
    'meta' in attachment ? attachment.meta : undefined

  describe('getDocumentFromAttachment', () => {
    it('converts attachment to Document schema', () => {
      const result = getDocumentFromAttachment(baseAttachment)

      expect(result).toEqual({
        type: 'Document',
        mediaType: 'image/jpeg',
        url: 'https://example.com/media/image.jpg',
        width: 1920,
        height: 1080,
        name: 'Test image'
      })
    })

    it('handles attachment without dimensions', () => {
      const attachmentNoDimensions = {
        ...baseAttachment,
        width: undefined,
        height: undefined
      }

      const result = getDocumentFromAttachment(attachmentNoDimensions)

      expect(result.type).toEqual('Document')
      expect(result.mediaType).toEqual('image/jpeg')
      expect(result.url).toEqual('https://example.com/media/image.jpg')
      expect(result.name).toEqual('Test image')
      expect(result.width).toBeUndefined()
      expect(result.height).toBeUndefined()
    })
  })

  describe('getMastodonAttachment', () => {
    it('returns image type for jpeg', () => {
      const result = getMastodonAttachment(baseAttachment)

      expect(result).not.toBeNull()
      expect(result?.type).toEqual('image')
      expect(result?.id).toEqual('attachment-123')
      expect(result?.url).toEqual('https://example.com/media/image.jpg')
      expect(result?.description).toEqual('Test image')
    })

    it('returns image type for png', () => {
      const pngAttachment = { ...baseAttachment, mediaType: 'image/png' }
      const result = getMastodonAttachment(pngAttachment)

      expect(result?.type).toEqual('image')
    })

    it('returns image type for webp', () => {
      const webpAttachment = { ...baseAttachment, mediaType: 'image/webp' }
      const result = getMastodonAttachment(webpAttachment)

      expect(result?.type).toEqual('image')
    })

    // `null` is not a MediaAttachment, and an entry with no id is one a client
    // cannot name — which an edit then reads as "remove it". Anything this
    // serializer cannot describe becomes Mastodon's `unknown` type instead,
    // carrying the id, url, description and blurhash it does have.
    it.each([
      ['gif, which is excluded from the image type', 'image/gif'],
      ['an audio upload, which has no stored duration', 'audio/mp4'],
      ['an unrecognised type', 'application/octet-stream']
    ])('returns the unknown type for %s', (_description, mediaType) => {
      const result = getMastodonAttachment({
        ...baseAttachment,
        mediaType,
        blurhash: 'LEHV6nWB2yk8pyo0adR*'
      })

      expect(result).toMatchObject({
        type: 'unknown',
        id: 'attachment-123',
        url: 'https://example.com/media/image.jpg',
        description: 'Test image',
        blurhash: 'LEHV6nWB2yk8pyo0adR*'
      })
    })

    it('returns video type for mp4', () => {
      const videoAttachment: Attachment = {
        ...baseAttachment,
        mediaType: 'video/mp4',
        url: 'https://example.com/media/video.mp4'
      }

      const result = getMastodonAttachment(videoAttachment)

      expect(result).not.toBeNull()
      expect(result?.type).toEqual('video')
      expect(result?.id).toEqual('attachment-123')
      expect(result?.url).toEqual('https://example.com/media/video.mp4')
    })

    // The upload path stores a focal point for a video's preview frame the
    // same way it does for an image, so the video entity has to carry it or a
    // focus a client set on a video is stored and never returned.
    it('serializes the focal point on a video attachment', () => {
      const result = getMastodonAttachment({
        ...baseAttachment,
        mediaType: 'video/mp4',
        focus: { x: -0.25, y: 0.5 }
      })

      expect(result?.type).toEqual('video')
      expect(metaOf(result)).toMatchObject({ focus: { x: -0.25, y: 0.5 } })
    })

    it('omits the focal point on a video attachment without one', () => {
      const result = getMastodonAttachment({
        ...baseAttachment,
        mediaType: 'video/mp4'
      })

      expect(metaOf(result)).not.toHaveProperty('focus')
    })

    it('returns video type for webm', () => {
      const webmAttachment: Attachment = {
        ...baseAttachment,
        mediaType: 'video/webm'
      }

      const result = getMastodonAttachment(webmAttachment)

      expect(result?.type).toEqual('video')
    })

    it('handles missing dimensions in image', () => {
      const attachmentNoDimensions: Attachment = {
        ...baseAttachment,
        width: undefined,
        height: undefined
      }

      const result = getMastodonAttachment(attachmentNoDimensions)

      expect(result).not.toBeNull()
      expect(metaOf(result)?.original?.width).toEqual(0)
      expect(metaOf(result)?.original?.height).toEqual(0)
    })

    it('handles missing dimensions in video', () => {
      const videoNoDimensions: Attachment = {
        ...baseAttachment,
        mediaType: 'video/mp4',
        width: undefined,
        height: undefined
      }

      const result = getMastodonAttachment(videoNoDimensions)

      expect(result).not.toBeNull()
      expect(metaOf(result)?.original?.width).toEqual(0)
      expect(metaOf(result)?.original?.height).toEqual(0)
    })

    it('calculates aspect ratio correctly', () => {
      const result = getMastodonAttachment(baseAttachment)

      // Asserted on the whole entity: `original` differs between the image and
      // video members, so only the image branch carries `size`/`aspect`.
      expect(result).toMatchObject({
        type: 'image',
        meta: {
          original: {
            size: '1920x1080',
            aspect: expect.closeTo(1920 / 1080)
          }
        }
      })
    })
  })

  describe('isFitnessAttachment', () => {
    it('returns true for fitness api references', () => {
      const result = isFitnessAttachment({
        mediaType: 'application/octet-stream',
        url: '/api/v1/fitness-files/fitness-file-id',
        name: 'workout.bin'
      })

      expect(result).toBe(true)
    })

    it('returns true for fit, gpx, and tcx mime types', () => {
      expect(
        isFitnessAttachment({
          mediaType: 'application/vnd.ant.fit',
          url: 'https://example.com/media/file.bin',
          name: 'file.bin'
        })
      ).toBe(true)

      expect(
        isFitnessAttachment({
          mediaType: 'application/gpx+xml',
          url: 'https://example.com/media/file.bin',
          name: 'file.bin'
        })
      ).toBe(true)

      expect(
        isFitnessAttachment({
          mediaType: 'application/tcx+xml',
          url: 'https://example.com/media/file.bin',
          name: 'file.bin'
        })
      ).toBe(true)
    })

    it('returns true when file name has fitness extension', () => {
      const result = isFitnessAttachment({
        mediaType: 'application/octet-stream',
        url: 'https://example.com/media/file.bin',
        name: 'Morning-Run.GPX'
      })

      expect(result).toBe(true)
    })

    it('returns false for non-fitness attachment', () => {
      const result = isFitnessAttachment({
        mediaType: 'image/png',
        url: 'https://example.com/media/image.png',
        name: 'image.png'
      })

      expect(result).toBe(false)
    })
  })

  describe('isVisualAttachment', () => {
    it.each([
      {
        description: 'returns true for image/jpeg',
        mediaType: 'image/jpeg',
        expected: true
      },
      {
        description: 'returns true for image/png',
        mediaType: 'image/png',
        expected: true
      },
      {
        description: 'returns true for image/gif',
        mediaType: 'image/gif',
        expected: true
      },
      {
        description: 'returns true for video/mp4',
        mediaType: 'video/mp4',
        expected: true
      },
      {
        description: 'returns true for video/quicktime',
        mediaType: 'video/quicktime',
        expected: true
      },
      {
        description: 'returns false for audio/mp4',
        mediaType: 'audio/mp4',
        expected: false
      },
      {
        description: 'returns false for audio/mpeg',
        mediaType: 'audio/mpeg',
        expected: false
      },
      {
        description: 'returns false for application/vnd.ant.fit',
        mediaType: 'application/vnd.ant.fit',
        expected: false
      },
      {
        description: 'returns false for application/gpx+xml',
        mediaType: 'application/gpx+xml',
        expected: false
      },
      {
        description: 'returns false for application/pdf',
        mediaType: 'application/pdf',
        expected: false
      },
      {
        description: 'returns false for an unknown media type',
        mediaType: '',
        expected: false
      }
    ])('$description', ({ mediaType, expected }) => {
      const result = isVisualAttachment({ ...baseAttachment, mediaType })

      expect(result).toBe(expected)
    })
  })

  describe('isRenderableAttachment', () => {
    // Must stay in step with the branches of lib/components/posts/media.tsx,
    // which renders image, video and audio and returns null for anything else.
    it.each([
      {
        description: 'returns true for image/jpeg',
        mediaType: 'image/jpeg',
        expected: true
      },
      {
        description: 'returns true for video/mp4',
        mediaType: 'video/mp4',
        expected: true
      },
      {
        description:
          'returns true for audio/mp4, which isVisualAttachment rejects',
        mediaType: 'audio/mp4',
        expected: true
      },
      {
        description: 'returns true for audio/mpeg',
        mediaType: 'audio/mpeg',
        expected: true
      },
      {
        description: 'returns false for a fitness file',
        mediaType: 'application/vnd.ant.fit',
        expected: false
      },
      {
        description: 'returns false for application/pdf',
        mediaType: 'application/pdf',
        expected: false
      },
      {
        description: 'returns false for an unknown media type',
        mediaType: '',
        expected: false
      }
    ])('$description', ({ mediaType, expected }) => {
      const result = isRenderableAttachment({ ...baseAttachment, mediaType })

      expect(result).toBe(expected)
    })
  })

  describe('isAudibleAttachment', () => {
    it.each([
      {
        description: 'returns true for audio/mp4',
        mediaType: 'audio/mp4',
        expected: true
      },
      {
        description: 'returns false for image/jpeg',
        mediaType: 'image/jpeg',
        expected: false
      },
      {
        description: 'returns false for video/mp4',
        mediaType: 'video/mp4',
        expected: false
      }
    ])('$description', ({ mediaType, expected }) => {
      const result = isAudibleAttachment({ ...baseAttachment, mediaType })

      expect(result).toBe(expected)
    })
  })
})
