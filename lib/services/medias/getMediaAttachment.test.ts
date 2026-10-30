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
  // A thumbnail a client uploaded shows the photo as it was before an edit.
  it('previews an edited photo with the edited file, not its old thumbnail', () => {
    const thumbnail = {
      path: 'medias/2026-01-01/thumb.jpg',
      bytes: 500,
      mimeType: 'image/jpeg',
      metaData: { width: 200, height: 150 }
    }
    const edited = getMediaAttachment(
      {
        ...baseMedia,
        original: { ...baseMedia.original, path: 'medias/render.webp' },
        thumbnail,
        edit: { version: 1, editedAt: Date.now() }
      },
      'llun.test'
    )
    expect(edited.preview_url).toBe(
      'https://llun.test/api/v1/files/medias/render.webp'
    )
    expect(edited.meta.small).toBeUndefined()

    // Reverted: the thumbnail stands for the live file again.
    const reverted = getMediaAttachment(
      { ...baseMedia, thumbnail, edit: { version: 2, editedAt: null } },
      'llun.test'
    )
    expect(reverted.preview_url).toBe(
      'https://llun.test/api/v1/files/medias/2026-01-01/thumb.jpg'
    )
  })

  it('classifies video mime types and emits null preview_url without thumbnail', () => {
    const attachment = getMediaAttachment(
      {
        ...baseMedia,
        original: { ...baseMedia.original, mimeType: 'video/mp4' }
      },
      'llun.test'
    )
    expect(attachment.type).toBe('video')
    expect(attachment.preview_url).toBeNull()
  })

  it('uses thumbnail path for video preview_url when thumbnail is present', () => {
    const attachment = getMediaAttachment(
      {
        ...baseMedia,
        original: { ...baseMedia.original, mimeType: 'video/mp4' },
        thumbnail: {
          path: 'medias/2026-01-01/video-poster.webp',
          bytes: 4000,
          mimeType: 'image/webp',
          metaData: { width: 1280, height: 720 }
        }
      },
      'llun.test'
    )
    expect(attachment.type).toBe('video')
    expect(attachment.preview_url).toBe(
      'https://llun.test/api/v1/files/medias/2026-01-01/video-poster.webp'
    )
  })

  it('emits null preview_url for audio without thumbnail', () => {
    const attachment = getMediaAttachment(
      {
        ...baseMedia,
        original: { ...baseMedia.original, mimeType: 'audio/mp4' }
      },
      'llun.test'
    )
    expect(attachment.type).toBe('audio')
    expect(attachment.preview_url).toBeNull()
  })

  it('emits null preview_url for non-image files without thumbnail', () => {
    const attachment = getMediaAttachment(
      {
        ...baseMedia,
        original: { ...baseMedia.original, mimeType: 'application/pdf' }
      },
      'llun.test'
    )
    expect(attachment.type).toBe('unknown')
    expect(attachment.preview_url).toBeNull()
  })

  it('serves over http for localhost hosts', () => {
    const attachment = getMediaAttachment(baseMedia, 'localhost:3000')
    expect(attachment.url).toBe(
      'http://localhost:3000/api/v1/files/medias/2026-01-01/image.jpg'
    )
  })

  it('normalises an empty stored description to null', () => {
    const attachment = getMediaAttachment(
      { ...baseMedia, description: '' },
      'llun.test'
    )
    expect(attachment.description).toBeNull()
  })

  it('normalises a whitespace-only stored description to null', () => {
    const attachment = getMediaAttachment(
      { ...baseMedia, description: '   ' },
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

  it('emits null blurhash when none is stored', () => {
    const attachment = getMediaAttachment(baseMedia, 'llun.test')
    expect(attachment.blurhash).toBeNull()
  })

  it('emits remote_url and preview_remote_url as null for local media', () => {
    const attachment = getMediaAttachment(baseMedia, 'llun.test')
    expect(attachment.remote_url).toBeNull()
    expect(attachment.preview_remote_url).toBeNull()
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
