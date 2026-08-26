import {
  EMPTY_ATTACHMENT_MEDIA_METADATA,
  getAttachmentMediaMetadata,
  getSavedMediaAttachmentMetadata
} from '@/lib/services/medias/attachmentMediaMetadata'
import { MediaStorageSaveFileOutput } from '@/lib/services/medias/types'

const savedMedia = (
  overrides: Partial<MediaStorageSaveFileOutput> = {}
): MediaStorageSaveFileOutput =>
  MediaStorageSaveFileOutput.parse({
    id: '42',
    type: 'image',
    mime_type: 'image/png',
    url: 'https://llun.test/api/v1/files/medias/original.png',
    preview_url: 'https://llun.test/api/v1/files/medias/original.png',
    text_url: null,
    remote_url: null,
    preview_remote_url: null,
    meta: {
      original: { width: 800, height: 600, size: '800x600', aspect: 1.33 }
    },
    description: null,
    blurhash: null,
    ...overrides
  })

describe('getAttachmentMediaMetadata', () => {
  it('reads the placeholder, focal point and thumbnail url off the media row', () => {
    expect(
      getAttachmentMediaMetadata(
        {
          blurhash: 'LEHV6nWB2yk8pyo0adR*',
          focus: { x: -0.5, y: 0.25 },
          thumbnail: {
            path: 'medias/2026-08-25/thumb.webp',
            bytes: 1000,
            mimeType: 'image/webp',
            metaData: { width: 200, height: 150 }
          }
        },
        'llun.test'
      )
    ).toEqual({
      blurhash: 'LEHV6nWB2yk8pyo0adR*',
      focus: { x: -0.5, y: 0.25 },
      thumbnailUrl:
        'https://llun.test/api/v1/files/medias/2026-08-25/thumb.webp'
    })
  })

  it.each([
    ['a media row with none of them', {}],
    ['no media row at all', null],
    ['an unresolved media row', undefined]
  ])('answers the empty snapshot for %s', (_description, media) => {
    expect(getAttachmentMediaMetadata(media, 'llun.test')).toEqual(
      EMPTY_ATTACHMENT_MEDIA_METADATA
    )
  })
})

describe('getSavedMediaAttachmentMetadata', () => {
  it('reads the placeholder and focal point off the stored media entity', () => {
    expect(
      getSavedMediaAttachmentMetadata(
        savedMedia({
          blurhash: 'LEHV6nWB2yk8pyo0adR*',
          meta: {
            original: {
              width: 800,
              height: 600,
              size: '800x600',
              aspect: 1.33
            },
            small: { width: 200, height: 150, size: '200x150', aspect: 1.33 },
            focus: { x: 0.1, y: -0.2 }
          },
          preview_url: 'https://llun.test/api/v1/files/medias/thumb.webp'
        })
      )
    ).toEqual({
      blurhash: 'LEHV6nWB2yk8pyo0adR*',
      focus: { x: 0.1, y: -0.2 },
      thumbnailUrl: 'https://llun.test/api/v1/files/medias/thumb.webp'
    })
  })

  // `getMediaAttachment` falls back to the original url when the row has no
  // stored thumbnail, so taking `preview_url` unconditionally would file the
  // full-size image as the post's preview.
  it('answers no thumbnail url when the entity carries no stored thumbnail', () => {
    expect(
      getSavedMediaAttachmentMetadata(savedMedia()).thumbnailUrl
    ).toBeNull()
  })
})
