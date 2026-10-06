import { MAX_STORED_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'

import { BaseNote } from './note'
import {
  getAttachments,
  getContent,
  getLanguage,
  getQuoteTargetId,
  getReply,
  getSummary,
  getTags,
  getUrl
} from './note'

describe('note entity utilities', () => {
  describe('getUrl', () => {
    it('returns string url directly', () => {
      expect(getUrl('https://example.com/note/1')).toEqual(
        'https://example.com/note/1'
      )
    })

    it('returns first string from array', () => {
      expect(
        getUrl([
          'https://example.com/note/1',
          'https://example.com/note/alternate'
        ])
      ).toEqual('https://example.com/note/1')
    })

    it('returns href from object in array', () => {
      expect(
        getUrl([{ href: 'https://example.com/note/1', type: 'Link' }])
      ).toEqual('https://example.com/note/1')
    })

    it('returns href from object', () => {
      expect(getUrl({ href: 'https://example.com/note/1' })).toEqual(
        'https://example.com/note/1'
      )
    })

    it('returns undefined for empty array', () => {
      expect(getUrl([])).toBeUndefined()
    })

    it.each([
      'javascript:alert(document.domain)',
      ['javascript:alert(1)'],
      { href: 'data:text/html,<script>alert(1)</script>' },
      [{ href: 'vbscript:msgbox(1)' }]
    ])('returns undefined for a non-http(s) url %j', (url) => {
      expect(getUrl(url)).toBeUndefined()
    })

    it('returns undefined for null', () => {
      expect(getUrl(null)).toBeUndefined()
    })
  })

  describe('getReply', () => {
    it('returns string reply directly', () => {
      expect(getReply('https://example.com/note/parent')).toEqual(
        'https://example.com/note/parent'
      )
    })

    it('returns id from object', () => {
      expect(getReply({ id: 'https://example.com/note/parent' })).toEqual(
        'https://example.com/note/parent'
      )
    })

    it('returns undefined for null', () => {
      expect(getReply(null)).toBeUndefined()
    })
  })

  describe('getQuoteTargetId', () => {
    const target = 'https://example.com/note/quoted'

    it.each([
      { field: 'quote' },
      { field: 'quoteUrl' },
      { field: 'quoteUri' },
      { field: '_misskey_quote' }
    ])('reads the quote target from $field', ({ field }) => {
      const note = {
        type: 'Note',
        id: 'https://example.com/note/1',
        [field]: target
      } as unknown as BaseNote

      expect(getQuoteTargetId(note)).toEqual(target)
    })

    it('reads the quote target from an embedded quote object', () => {
      const note = {
        type: 'Note',
        id: 'https://example.com/note/1',
        quote: { id: target, type: 'Note' }
      } as unknown as BaseNote

      expect(getQuoteTargetId(note)).toEqual(target)
    })

    it.each([
      { field: 'quote' },
      { field: 'quoteUrl' },
      { field: 'quoteUri' },
      { field: '_misskey_quote' }
    ])('rejects a non-http(s) quote target in $field', ({ field }) => {
      const note = {
        type: 'Note',
        id: 'https://example.com/note/1',
        [field]: 'javascript:alert(document.domain)'
      } as unknown as BaseNote

      expect(getQuoteTargetId(note)).toBeNull()
    })

    it('prefers quote over the compat aliases', () => {
      const note = {
        type: 'Note',
        id: 'https://example.com/note/1',
        quote: target,
        quoteUri: 'https://example.com/note/other',
        _misskey_quote: 'https://example.com/note/other'
      } as unknown as BaseNote

      expect(getQuoteTargetId(note)).toEqual(target)
    })

    it('returns null when the note quotes nothing', () => {
      const note = {
        type: 'Note',
        id: 'https://example.com/note/1',
        content: 'Test'
      } as unknown as BaseNote

      expect(getQuoteTargetId(note)).toBeNull()
    })

    it('returns null for an embedded quote object without an id', () => {
      const note = {
        type: 'Note',
        id: 'https://example.com/note/1',
        quote: { type: 'Link', href: 'https://example.com/note/quoted' }
      } as unknown as BaseNote

      expect(getQuoteTargetId(note)).toBeNull()
    })
  })

  describe('getAttachments', () => {
    // Regression (F047): ingest kept every Document a remote Note carried, so
    // one signed Note could write hundreds of attachment rows and put as many
    // video elements into every viewer's timeline.
    it('keeps no more attachments than a local status may store', () => {
      const note = {
        type: 'Note',
        id: 'https://example.com/note/1',
        content: 'Test',
        attachment: Array.from(
          { length: MAX_STORED_MEDIA_ATTACHMENTS + 25 },
          (_, index) => ({
            type: 'Document',
            mediaType: 'video/mp4',
            url: `https://example.com/video-${index}.mp4`
          })
        )
      } as BaseNote

      const result = getAttachments(note)

      expect(result).toHaveLength(MAX_STORED_MEDIA_ATTACHMENTS)
      expect(result[0].url).toEqual('https://example.com/video-0.mp4')
    })

    it('drops attachments whose url is not http(s)', () => {
      const note: BaseNote = {
        type: 'Note',
        id: 'https://example.com/note/1',
        content: 'Test',
        attachment: [
          {
            type: 'Document',
            mediaType: 'application/pdf',
            url: 'javascript:alert(document.domain)'
          },
          {
            type: 'Document',
            mediaType: 'text/html',
            url: 'data:text/html,<script>alert(1)</script>'
          },
          {
            type: 'Document',
            mediaType: 'image/jpeg',
            url: 'https://example.com/image.jpg'
          }
        ]
      } as BaseNote

      expect(getAttachments(note).map((item) => item.url)).toEqual([
        'https://example.com/image.jpg'
      ])
    })

    // Mastodon sends every media attachment as a Document, but Pixelfed,
    // Friendica and Funkwhale use the dedicated ActivityStreams media types.
    // Only Document used to be kept, so their posts arrived with no media.
    describe('ActivityStreams media attachment types', () => {
      it('keeps Pixelfed Image attachments with their alt text and blurhash', () => {
        const note = {
          type: 'Note',
          id: 'https://pixelfed.example/p/alice/700000000000000001',
          attributedTo: 'https://pixelfed.example/users/alice',
          content: '<p>Morning light</p>',
          attachment: [
            {
              type: 'Image',
              mediaType: 'image/jpeg',
              url: 'https://pixelfed.example/storage/m/_v2/1/abc/def/photo.jpg',
              name: 'Sunrise over the lake',
              blurhash: 'U9Fi1M%M00Rj~qM{IUWB00of_3t7%MWBM{xu',
              width: 1080,
              height: 1350
            },
            {
              type: 'Image',
              mediaType: 'image/png',
              url: 'https://pixelfed.example/storage/m/_v2/1/abc/def/second.png',
              name: null,
              blurhash: 'U00000fQfQfQfQfQfQfQfQfQfQfQ',
              width: 800,
              height: 600
            }
          ]
        } as unknown as BaseNote

        expect(getAttachments(note)).toEqual([
          {
            type: 'Document',
            mediaType: 'image/jpeg',
            url: 'https://pixelfed.example/storage/m/_v2/1/abc/def/photo.jpg',
            name: 'Sunrise over the lake',
            blurhash: 'U9Fi1M%M00Rj~qM{IUWB00of_3t7%MWBM{xu',
            width: 1080,
            height: 1350
          },
          {
            type: 'Document',
            mediaType: 'image/png',
            url: 'https://pixelfed.example/storage/m/_v2/1/abc/def/second.png',
            blurhash: 'U00000fQfQfQfQfQfQfQfQfQfQfQ',
            width: 800,
            height: 600
          }
        ])
      })

      it('keeps Pixelfed Video attachments', () => {
        const note = {
          type: 'Note',
          id: 'https://pixelfed.example/p/alice/700000000000000002',
          content: '<p>Clip</p>',
          attachment: [
            {
              type: 'Video',
              mediaType: 'video/mp4',
              url: 'https://pixelfed.example/storage/m/_v2/1/abc/def/clip.mp4',
              name: 'Waves rolling in'
            }
          ]
        } as unknown as BaseNote

        expect(getAttachments(note)).toEqual([
          {
            type: 'Document',
            mediaType: 'video/mp4',
            url: 'https://pixelfed.example/storage/m/_v2/1/abc/def/clip.mp4',
            name: 'Waves rolling in'
          }
        ])
      })

      it('keeps Friendica Image and Audio attachments, defaulting a missing mediaType by kind', () => {
        const note = {
          type: 'Note',
          id: 'https://friendica.example/objects/0b6a5a0c-1065-0d3f-9c3e-2c1d63000001',
          content: 'Photo and a voice note',
          attachment: [
            {
              type: 'Image',
              url: 'https://friendica.example/photo/8b4e0c5f2a1d-0.jpg',
              name: ''
            },
            {
              type: 'Audio',
              mediaType: 'audio/ogg',
              url: 'https://friendica.example/attach/42',
              name: 'voice-note.ogg'
            },
            {
              type: 'Audio',
              url: 'https://friendica.example/attach/43'
            }
          ]
        } as unknown as BaseNote

        expect(
          getAttachments(note).map(({ mediaType, url }) => ({ mediaType, url }))
        ).toEqual([
          {
            mediaType: 'image/jpeg',
            url: 'https://friendica.example/photo/8b4e0c5f2a1d-0.jpg'
          },
          {
            mediaType: 'audio/ogg',
            url: 'https://friendica.example/attach/42'
          },
          {
            mediaType: 'audio/mpeg',
            url: 'https://friendica.example/attach/43'
          }
        ])
      })

      it('reads a url given as a Link, or as an array of Link renditions', () => {
        const note = {
          type: 'Note',
          id: 'https://remote.example/notes/1',
          content: 'Links',
          attachment: [
            {
              type: 'Image',
              url: {
                type: 'Link',
                href: 'https://remote.example/media/photo.webp',
                mediaType: 'image/webp'
              }
            },
            {
              type: 'Video',
              url: [
                {
                  type: 'Link',
                  href: 'https://remote.example/media/clip.m3u8',
                  mediaType: 'application/x-mpegURL'
                },
                {
                  type: 'Link',
                  href: 'https://remote.example/media/clip.webm',
                  mediaType: 'video/webm'
                }
              ]
            },
            {
              type: 'Document',
              mediaType: 'application/pdf',
              url: [{ type: 'Link', href: 'https://remote.example/doc.pdf' }]
            }
          ]
        } as unknown as BaseNote

        expect(
          getAttachments(note).map(({ mediaType, url }) => ({ mediaType, url }))
        ).toEqual([
          {
            mediaType: 'image/webp',
            url: 'https://remote.example/media/photo.webp'
          },
          {
            mediaType: 'video/webm',
            url: 'https://remote.example/media/clip.webm'
          },
          {
            mediaType: 'application/pdf',
            url: 'https://remote.example/doc.pdf'
          }
        ])
      })

      it('types the stored url by the rendition chosen, not the attachment', () => {
        const note = {
          type: 'Note',
          id: 'https://remote.example/notes/1',
          content: 'Renditions',
          attachment: [
            {
              type: 'Video',
              mediaType: 'video/mp4',
              url: [
                {
                  type: 'Link',
                  href: 'https://remote.example/clip.webm',
                  mediaType: 'video/webm'
                }
              ]
            }
          ]
        } as unknown as BaseNote

        expect(getAttachments(note)[0].mediaType).toEqual('video/webm')
      })

      it('keeps a Video poster from icon and a Document thumbnailUrl', () => {
        const note = {
          type: 'Note',
          id: 'https://remote.example/notes/1',
          content: 'Posters',
          attachment: [
            {
              type: 'Video',
              mediaType: 'video/mp4',
              url: 'https://remote.example/clip.mp4',
              icon: { type: 'Image', url: 'https://remote.example/poster.jpg' }
            },
            {
              type: 'Document',
              mediaType: 'video/mp4',
              url: { type: 'Link', href: 'https://remote.example/doc.mp4' },
              thumbnailUrl: 'https://remote.example/doc-thumb.jpg'
            },
            {
              type: 'Video',
              mediaType: 'video/mp4',
              url: 'https://remote.example/other.mp4',
              icon: 'javascript:alert(1)'
            }
          ]
        } as unknown as BaseNote

        expect(
          getAttachments(note).map(({ url, thumbnailUrl }) => ({
            url,
            thumbnailUrl
          }))
        ).toEqual([
          {
            url: 'https://remote.example/clip.mp4',
            thumbnailUrl: 'https://remote.example/poster.jpg'
          },
          {
            url: 'https://remote.example/doc.mp4',
            thumbnailUrl: 'https://remote.example/doc-thumb.jpg'
          },
          { url: 'https://remote.example/other.mp4', thumbnailUrl: undefined }
        ])
      })

      it('keeps the attachment when only its focalPoint is malformed', () => {
        const note = {
          type: 'Note',
          id: 'https://remote.example/notes/1',
          content: 'Focus',
          attachment: [
            {
              type: 'Image',
              mediaType: 'image/jpeg',
              url: 'https://remote.example/photo.jpg',
              focalPoint: 'center'
            }
          ]
        } as unknown as BaseNote

        expect(getAttachments(note)).toEqual([
          {
            type: 'Document',
            mediaType: 'image/jpeg',
            url: 'https://remote.example/photo.jpg'
          }
        ])
      })

      it('still drops non-media and unsafe attachments', () => {
        const note = {
          type: 'Note',
          id: 'https://remote.example/notes/1',
          content: 'Mixed',
          attachment: [
            { type: 'PropertyValue', name: 'Website', value: 'x' },
            { type: 'Link', href: 'https://remote.example/page' },
            { type: 'Image', url: 'javascript:alert(1)' },
            { type: 'Video', mediaType: 'video/mp4' },
            { type: 'Document', url: 'https://remote.example/unknown' },
            // Inherited Object.prototype keys are not media kinds.
            { type: 'constructor', url: 'https://remote.example/a.jpg' },
            { type: 'toString', url: 'https://remote.example/b.jpg' },
            { type: '__proto__', url: 'https://remote.example/c.jpg' },
            // A Video whose only rendition is an HTML watch page.
            {
              type: 'Video',
              mediaType: 'video/mp4',
              url: [
                {
                  type: 'Link',
                  href: 'https://remote.example/watch/1',
                  mediaType: 'text/html'
                }
              ]
            }
          ]
        } as unknown as BaseNote

        expect(getAttachments(note)).toEqual([])
      })
    })

    it('returns attachments array', () => {
      const note: BaseNote = {
        type: 'Note',
        id: 'https://example.com/note/1',
        content: 'Test',
        attachment: [
          {
            type: 'Document',
            mediaType: 'image/jpeg',
            url: 'https://example.com/image.jpg'
          }
        ]
      } as BaseNote

      const result = getAttachments(note)

      expect(result).toHaveLength(1)
      expect(result[0].url).toEqual('https://example.com/image.jpg')
    })

    it('wraps single attachment in array', () => {
      const note: BaseNote = {
        type: 'Note',
        id: 'https://example.com/note/1',
        content: 'Test',
        attachment: {
          type: 'Document',
          mediaType: 'image/jpeg',
          url: 'https://example.com/image.jpg'
        }
      } as BaseNote

      const result = getAttachments(note)

      expect(result).toHaveLength(1)
    })

    it('returns empty array when no attachments', () => {
      const note: BaseNote = {
        type: 'Note',
        id: 'https://example.com/note/1',
        content: 'Test'
      } as BaseNote

      const result = getAttachments(note)

      expect(result).toHaveLength(0)
    })

    it('extracts attachment from Image type object', () => {
      const imageNote = {
        type: 'Image',
        id: 'https://example.com/image/1',
        url: 'https://example.com/photo.jpg',
        mediaType: 'image/jpeg',
        width: 800,
        height: 600,
        name: 'A photo'
      } as unknown as BaseNote

      const result = getAttachments(imageNote)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'Document',
        mediaType: 'image/jpeg',
        url: 'https://example.com/photo.jpg',
        name: 'A photo',
        width: 800,
        height: 600,
        blurhash: undefined
      })
    })

    it('extracts attachment from Video type object', () => {
      const videoNote = {
        type: 'Video',
        id: 'https://example.com/video/1',
        url: 'https://example.com/movie.mp4',
        mediaType: 'video/mp4',
        width: 1920,
        height: 1080
      } as unknown as BaseNote

      const result = getAttachments(videoNote)

      expect(result).toHaveLength(1)
      expect(result[0].type).toEqual('Document')
      expect(result[0].mediaType).toEqual('video/mp4')
    })

    it('uses default media type for Image without mediaType', () => {
      const imageNote = {
        type: 'Image',
        id: 'https://example.com/image/1',
        url: 'https://example.com/photo.jpg'
      } as unknown as BaseNote

      const result = getAttachments(imageNote)

      expect(result[0].mediaType).toEqual('image/jpeg')
    })

    it('uses default media type for Video without mediaType', () => {
      const videoNote = {
        type: 'Video',
        id: 'https://example.com/video/1',
        url: 'https://example.com/movie.mp4'
      } as unknown as BaseNote

      const result = getAttachments(videoNote)

      expect(result[0].mediaType).toEqual('video/mp4')
    })

    it('extracts playable video stream and icon thumbnail from PeerTube Video object', () => {
      const peertubeVideo = {
        type: 'Video',
        id: 'https://framatube.org/videos/watch/123',
        mediaType: 'text/markdown',
        url: [
          {
            type: 'Link',
            mediaType: 'text/html',
            href: 'https://framatube.org/videos/watch/123'
          },
          {
            type: 'Link',
            mediaType: 'video/mp4',
            href: 'https://framatube.org/static/webseed/123.mp4',
            height: 1080,
            width: 1920
          }
        ],
        icon: [
          {
            type: 'Image',
            url: 'https://framatube.org/lazy-static/video-thumbnails/123.jpg',
            width: 1920,
            height: 1080
          }
        ]
      } as unknown as BaseNote

      const result = getAttachments(peertubeVideo)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        type: 'Document',
        mediaType: 'video/mp4',
        url: 'https://framatube.org/static/webseed/123.mp4',
        thumbnailUrl:
          'https://framatube.org/lazy-static/video-thumbnails/123.jpg',
        width: 1920,
        height: 1080
      })
    })

    it('does not extract attachment if video url array only contains html watch pages', () => {
      const videoWithoutStreams = {
        type: 'Video',
        id: 'https://peertube.example/videos/watch/123',
        url: [
          {
            type: 'Link',
            mediaType: 'text/html',
            href: 'https://peertube.example/videos/watch/123'
          }
        ]
      } as unknown as BaseNote

      const result = getAttachments(videoWithoutStreams)
      expect(result).toHaveLength(0)
    })

    it('resolves nested link icon for Video thumbnail', () => {
      const videoWithNestedIcon = {
        type: 'Video',
        id: 'https://example.com/video/1',
        url: 'https://example.com/stream.m3u8',
        icon: {
          type: 'Link',
          href: 'https://example.com/thumb.jpg'
        }
      } as unknown as BaseNote

      const result = getAttachments(videoWithNestedIcon)
      expect(result).toHaveLength(1)
      expect(result[0].thumbnailUrl).toBe('https://example.com/thumb.jpg')
    })

    it('prioritizes direct MP4 stream over HLS playlist in video url array', () => {
      const video = {
        type: 'Video',
        id: 'https://peertube.example/videos/1',
        url: [
          {
            type: 'Link',
            mediaType: 'application/x-mpegURL',
            href: 'https://peertube.example/master.m3u8'
          },
          {
            type: 'Link',
            mediaType: 'video/mp4',
            href: 'https://peertube.example/video.mp4',
            width: 1920,
            height: 1080
          }
        ]
      } as unknown as BaseNote

      const result = getAttachments(video)
      expect(result).toHaveLength(1)
      expect(result[0].url).toBe('https://peertube.example/video.mp4')
      expect(result[0].mediaType).toBe('video/mp4')
    })

    it('extracts direct video stream from string URLs in url array', () => {
      const video = {
        type: 'Video',
        id: 'https://example.com/video/1',
        url: ['https://example.com/video.mp4']
      } as unknown as BaseNote

      const result = getAttachments(video)
      expect(result).toHaveLength(1)
      expect(result[0].url).toBe('https://example.com/video.mp4')
    })

    it('tolerates non-string mediaType or href without throwing TypeError', () => {
      const malformedVideo = {
        type: 'Video',
        id: 'https://example.com/video/1',
        url: [
          {
            type: 'Link',
            mediaType: 12345,
            href: null
          },
          {
            type: 'Link',
            mediaType: 'video/mp4',
            href: 'https://example.com/good.mp4'
          }
        ]
      } as unknown as BaseNote

      expect(() => getAttachments(malformedVideo)).not.toThrow()
      const result = getAttachments(malformedVideo)
      expect(result).toHaveLength(1)
      expect(result[0].url).toBe('https://example.com/good.mp4')
    })
  })

  describe('getTags', () => {
    it('returns tags array', () => {
      const note = {
        type: 'Note',
        tag: [
          {
            type: 'Hashtag',
            name: '#test',
            href: 'https://example.com/tags/test'
          },
          {
            type: 'Mention',
            name: '@someone',
            href: 'https://example.com/users/someone'
          }
        ]
      } as unknown as BaseNote

      const result = getTags(note)

      expect(result).toHaveLength(2)
    })

    it('wraps single tag in array', () => {
      const note = {
        type: 'Note',
        tag: {
          type: 'Hashtag',
          name: '#single',
          href: 'https://example.com/tags/single'
        }
      } as unknown as BaseNote

      const result = getTags(note)

      expect(result).toHaveLength(1)
    })

    it('returns empty array when no tags', () => {
      const note = {
        type: 'Note'
      } as unknown as BaseNote

      const result = getTags(note)

      expect(result).toHaveLength(0)
    })
  })

  describe('getContent', () => {
    it('returns content string directly', () => {
      const note = {
        type: 'Note',
        content: '<p>Hello world</p>'
      } as unknown as BaseNote

      expect(getContent(note)).toEqual('<p>Hello world</p>')
    })

    it('returns first item from content array (WordPress compat)', () => {
      const note = {
        type: 'Note',
        content: ['First content', 'Second content']
      } as unknown as BaseNote

      expect(getContent(note)).toEqual('First content')
    })

    it('returns content from contentMap', () => {
      const note = {
        type: 'Note',
        contentMap: { en: '<p>English content</p>' }
      } as unknown as BaseNote

      expect(getContent(note)).toEqual('<p>English content</p>')
    })

    it('returns first item from contentMap array (WordPress compat)', () => {
      const note = {
        type: 'Note',
        contentMap: ['<p>First</p>', '<p>Second</p>']
      } as unknown as BaseNote

      expect(getContent(note)).toEqual('<p>First</p>')
    })

    it('returns empty string when contentMap is empty', () => {
      const note = {
        type: 'Note',
        contentMap: {}
      } as unknown as BaseNote

      expect(getContent(note)).toEqual('')
    })

    it('returns empty string when no content', () => {
      const note = {
        type: 'Note'
      } as unknown as BaseNote

      expect(getContent(note)).toEqual('')
    })

    it('prepends Video name to content when object is a Video', () => {
      const video = {
        type: 'Video',
        name: 'My Cool Video',
        content: '<p>Description of the video</p>'
      } as unknown as BaseNote

      expect(getContent(video)).toEqual(
        '<p><strong>My Cool Video</strong></p>\n<p>Description of the video</p>'
      )
    })

    it('returns Video name in paragraph when Video has no content', () => {
      const video = {
        type: 'Video',
        name: 'My Cool Video'
      } as unknown as BaseNote

      expect(getContent(video)).toEqual('<p><strong>My Cool Video</strong></p>')
    })

    it('escapes HTML in Video name', () => {
      const video = {
        type: 'Video',
        name: 'Tom & Jerry <Live>',
        content: '<p>Episode 1</p>'
      } as unknown as BaseNote

      expect(getContent(video)).toEqual(
        '<p><strong>Tom &amp; Jerry &lt;Live&gt;</strong></p>\n<p>Episode 1</p>'
      )
    })

    it('does not duplicate title if Video content already starts with formatted title', () => {
      const video = {
        type: 'Video',
        name: 'My Cool Video',
        content: '<p><strong>My Cool Video</strong></p>\n<p>Description</p>'
      } as unknown as BaseNote

      expect(getContent(video)).toEqual(
        '<p><strong>My Cool Video</strong></p>\n<p>Description</p>'
      )
    })
  })

  describe('getSummary', () => {
    it('returns summary string directly', () => {
      const note = {
        type: 'Note',
        summary: 'Content warning: test'
      } as unknown as BaseNote

      expect(getSummary(note)).toEqual('Content warning: test')
    })

    it('returns summary from summaryMap', () => {
      const note = {
        type: 'Note',
        summaryMap: { en: 'English summary' }
      } as unknown as BaseNote

      expect(getSummary(note)).toEqual('English summary')
    })

    it('returns empty string when summaryMap is empty', () => {
      const note = {
        type: 'Note',
        summaryMap: {}
      } as unknown as BaseNote

      expect(getSummary(note)).toEqual('')
    })

    it('returns empty string when no summary', () => {
      const note = {
        type: 'Note'
      } as unknown as BaseNote

      expect(getSummary(note)).toEqual('')
    })
  })

  describe('getLanguage', () => {
    it.each([
      {
        description: 'uses the first contentMap key',
        note: { type: 'Note', contentMap: { th: '<p>สวัสดี</p>' } },
        expected: 'th'
      },
      {
        description: 'normalizes a regional contentMap key to ISO 639-1',
        note: { type: 'Note', contentMap: { 'en-US': '<p>Hello</p>' } },
        expected: 'en'
      },
      {
        description: 'returns null for the array/Wordpress contentMap shape',
        note: { type: 'Note', contentMap: ['<p>Hello</p>'] },
        expected: null
      },
      {
        description: 'returns null when contentMap is empty',
        note: { type: 'Note', contentMap: {} },
        expected: null
      },
      {
        description: 'falls back to the first summaryMap key',
        note: { type: 'Note', summaryMap: { de: 'Zusammenfassung' } },
        expected: 'de'
      },
      {
        description: 'prefers contentMap over summaryMap when both are present',
        note: {
          type: 'Note',
          contentMap: { ja: '<p>こんにちは</p>' },
          summaryMap: { en: 'Summary' }
        },
        expected: 'ja'
      },
      {
        description: 'returns null when neither map is present',
        note: { type: 'Note' },
        expected: null
      },
      {
        description: 'returns null for a non-alphabetic locale key',
        note: { type: 'Note', contentMap: { '12': '<p>Hello</p>' } },
        expected: null
      },
      {
        description: 'returns null for a single-character locale key',
        note: { type: 'Note', contentMap: { a: '<p>Hello</p>' } },
        expected: null
      },
      {
        description:
          'returns null for a 3-letter ISO 639-2/3 code instead of truncating it',
        note: { type: 'Note', contentMap: { fil: '<p>Kamusta</p>' } },
        expected: null
      },
      {
        description: 'normalizes an underscore regional contentMap key',
        note: { type: 'Note', contentMap: { en_US: '<p>Hello</p>' } },
        expected: 'en'
      }
    ])('$description', ({ note, expected }) => {
      expect(getLanguage(note as unknown as BaseNote)).toEqual(expected)
    })
  })
})
