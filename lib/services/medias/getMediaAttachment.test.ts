import { getMediaAttachment } from '@/lib/services/medias/getMediaAttachment'
import { Media } from '@/lib/types/database/operations'

const baseMedia: Media = {
  id: '42',
  actorId: 'https://llun.test/users/test',
  original: {
    path: 'medias/2026-01-01/image.jpg',
    bytes: 1000,
    mimeType: 'image/jpeg',
    metaData: { width: 800, height: 600 }
  },
  description: 'a cat'
}

describe('getMediaAttachment', () => {
  it('builds an image attachment served from /api/v1/files', () => {
    const attachment = getMediaAttachment(baseMedia, 'llun.test')
    expect(attachment).toMatchObject({
      id: '42',
      type: 'image',
      mime_type: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/medias/2026-01-01/image.jpg',
      preview_url: 'https://llun.test/api/v1/files/medias/2026-01-01/image.jpg',
      description: 'a cat'
    })
    expect(attachment.meta.original).toEqual({
      width: 800,
      height: 600,
      size: '800x600',
      aspect: 800 / 600
    })
  })

  it('uses the thumbnail path for preview_url and meta.small when present', () => {
    const attachment = getMediaAttachment(
      {
        ...baseMedia,
        thumbnail: {
          path: 'medias/2026-01-01/thumb.jpg',
          bytes: 500,
          mimeType: 'image/jpeg',
          metaData: { width: 200, height: 150 }
        }
      },
      'llun.test'
    )
    expect(attachment.preview_url).toBe(
      'https://llun.test/api/v1/files/medias/2026-01-01/thumb.jpg'
    )
    expect(attachment.meta.small).toEqual({
      width: 200,
      height: 150,
      size: '200x150',
      aspect: 200 / 150
    })
  })

  it('classifies video mime types', () => {
    const attachment = getMediaAttachment(
      {
        ...baseMedia,
        original: { ...baseMedia.original, mimeType: 'video/mp4' }
      },
      'llun.test'
    )
    expect(attachment.type).toBe('video')
  })

  it('serves over http for localhost hosts', () => {
    const attachment = getMediaAttachment(baseMedia, 'localhost:3000')
    expect(attachment.url).toBe(
      'http://localhost:3000/api/v1/files/medias/2026-01-01/image.jpg'
    )
  })

  it('emits a null description when none is stored', () => {
    const { description: _description, ...withoutDescription } = baseMedia
    const attachment = getMediaAttachment(withoutDescription, 'llun.test')
    expect(attachment.description).toBeNull()
  })

  it('normalises an empty stored description to null', () => {
    const attachment = getMediaAttachment(
      { ...baseMedia, description: '' },
      'llun.test'
    )
    expect(attachment.description).toBeNull()
  })

  it.each([
    {
      description: 'image/png maps to image',
      mimeType: 'image/png',
      type: 'image'
    },
    {
      description: 'video/mp4 maps to video',
      mimeType: 'video/mp4',
      type: 'video'
    },
    {
      description: 'audio/mp4 maps to audio',
      mimeType: 'audio/mp4',
      type: 'audio'
    },
    {
      description: 'unrecognised mime maps to unknown',
      mimeType: 'application/zip',
      type: 'unknown'
    }
  ])('$description', ({ mimeType, type }) => {
    const attachment = getMediaAttachment(
      { ...baseMedia, original: { ...baseMedia.original, mimeType } },
      'llun.test'
    )
    expect(attachment.type).toBe(type)
  })

  it('always emits a null blurhash (not yet computed)', () => {
    const attachment = getMediaAttachment(baseMedia, 'llun.test')
    expect(attachment.blurhash).toBeNull()
  })

  it('emits remote_url and preview_remote_url as null for local media', () => {
    const attachment = getMediaAttachment(baseMedia, 'llun.test')
    expect(attachment.remote_url).toBeNull()
    expect(attachment.preview_remote_url).toBeNull()
  })

  it('emits meta.focus when the media has a focal point', () => {
    const attachment = getMediaAttachment(
      { ...baseMedia, focus: { x: 0.5, y: -0.25 } },
      'llun.test'
    )
    expect(attachment.meta.focus).toEqual({ x: 0.5, y: -0.25 })
  })

  it('omits meta.focus when there is no focal point', () => {
    const attachment = getMediaAttachment(baseMedia, 'llun.test')
    expect(attachment.meta.focus).toBeUndefined()
  })

  it('avoids division by zero when height is missing', () => {
    const attachment = getMediaAttachment(
      {
        ...baseMedia,
        original: { ...baseMedia.original, metaData: { width: 100, height: 0 } }
      },
      'llun.test'
    )
    expect(attachment.meta.original.aspect).toBe(100)
  })
})
