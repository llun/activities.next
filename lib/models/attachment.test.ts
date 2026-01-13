import { Attachment } from './attachment'
import { getDocumentFromAttachment, getMastodonAttachment } from './attachment'

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

  describe('#getDocumentFromAttachment', () => {
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

  describe('#getMastodonAttachment', () => {
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

    it('returns null for gif (treated differently)', () => {
      const gifAttachment = { ...baseAttachment, mediaType: 'image/gif' }
      const result = getMastodonAttachment(gifAttachment)

      // GIFs are excluded from image type
      expect(result).toBeNull()
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

    it('returns video type for webm', () => {
      const webmAttachment: Attachment = {
        ...baseAttachment,
        mediaType: 'video/webm'
      }

      const result = getMastodonAttachment(webmAttachment)

      expect(result?.type).toEqual('video')
    })

    it('returns null for unsupported media types', () => {
      const audioAttachment: Attachment = {
        ...baseAttachment,
        mediaType: 'audio/mp3'
      }

      const result = getMastodonAttachment(audioAttachment)

      expect(result).toBeNull()
    })

    it('handles missing dimensions in image', () => {
      const attachmentNoDimensions: Attachment = {
        ...baseAttachment,
        width: undefined,
        height: undefined
      }

      const result = getMastodonAttachment(attachmentNoDimensions)

      expect(result).not.toBeNull()
      expect(result?.meta?.original?.width).toEqual(0)
      expect(result?.meta?.original?.height).toEqual(0)
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
      expect(result?.meta?.original?.width).toEqual(0)
      expect(result?.meta?.original?.height).toEqual(0)
    })

    it('calculates aspect ratio correctly', () => {
      const result = getMastodonAttachment(baseAttachment)

      expect(result?.meta?.original?.aspect).toBeCloseTo(1920 / 1080)
      expect(result?.meta?.original?.size).toEqual('1920x1080')
    })
  })
})
