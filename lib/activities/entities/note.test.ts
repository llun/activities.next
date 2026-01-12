import { BaseNote } from './note'
import {
  getAttachments,
  getContent,
  getReply,
  getSummary,
  getTags,
  getUrl
} from './note'

describe('note entity utilities', () => {
  describe('#getUrl', () => {
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

    it('returns undefined for null', () => {
      expect(getUrl(null)).toBeUndefined()
    })
  })

  describe('#getReply', () => {
    it('returns string reply directly', () => {
      expect(getReply('https://example.com/note/parent')).toEqual(
        'https://example.com/note/parent'
      )
    })

    it('returns id from object', () => {
      expect(
        getReply({ id: 'https://example.com/note/parent', type: 'Note' })
      ).toEqual('https://example.com/note/parent')
    })

    it('returns undefined for null', () => {
      expect(getReply(null)).toBeUndefined()
    })
  })

  describe('#getAttachments', () => {
    it('returns attachments array', () => {
      const note: BaseNote = {
        type: 'Note',
        id: 'https://example.com/note/1',
        content: 'Test',
        attachment: [{ type: 'Document', url: 'https://example.com/image.jpg' }]
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
        attachment: { type: 'Document', url: 'https://example.com/image.jpg' }
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
  })

  describe('#getTags', () => {
    it('returns tags array', () => {
      const note = {
        type: 'Note',
        tag: [
          { type: 'Hashtag', name: '#test' },
          { type: 'Mention', href: 'https://example.com/users/someone' }
        ]
      } as unknown as BaseNote

      const result = getTags(note)

      expect(result).toHaveLength(2)
    })

    it('wraps single tag in array', () => {
      const note = {
        type: 'Note',
        tag: { type: 'Hashtag', name: '#single' }
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

  describe('#getContent', () => {
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
  })

  describe('#getSummary', () => {
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
})
