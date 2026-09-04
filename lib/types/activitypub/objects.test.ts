import {
  ImageContent,
  Note,
  Question,
  VideoContent
} from '@/lib/types/activitypub/objects'

describe('Note quote fields', () => {
  const base = {
    id: 'https://remote.example/notes/1',
    type: 'Note' as const,
    attributedTo: 'https://remote.example/users/alice',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    content: 'quoting',
    published: '2026-01-01T00:00:00Z'
  }

  it('accepts a string quote target', () => {
    const result = Note.safeParse({
      ...base,
      quote: 'https://llun.test/users/me/statuses/1'
    })
    expect(result.success).toBe(true)
  })

  it('accepts an embedded quote object without an id instead of rejecting the whole note', () => {
    // Liberal-inbound mandate: an unusual/blank-node quote value must never drop
    // the entire note.
    const result = Note.safeParse({
      ...base,
      quote: { type: 'Link', href: 'https://llun.test/users/me/statuses/1' }
    })
    expect(result.success).toBe(true)
  })
})

describe('Question', () => {
  const option = (name: string) => ({
    type: 'Note' as const,
    name,
    replies: { type: 'Collection' as const, totalItems: 0 }
  })

  const base = {
    id: 'https://remote.example/polls/1',
    type: 'Question' as const,
    attributedTo: 'https://remote.example/users/alice',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    content: 'Single option?',
    published: '2026-01-01T00:00:00Z',
    endTime: '2026-01-02T00:00:00Z'
  }

  // JSON-LD compaction collapses a single-option `oneOf`/`anyOf` array to a bare
  // object, so the schema must tolerate either shape and normalise to an array.
  it.each([
    { field: 'oneOf' as const, description: 'an array', input: [option('A')] },
    {
      field: 'oneOf' as const,
      description: 'a single collapsed object',
      input: option('A')
    },
    { field: 'anyOf' as const, description: 'an array', input: [option('A')] },
    {
      field: 'anyOf' as const,
      description: 'a single collapsed object',
      input: option('A')
    }
  ])(
    'accepts $field as $description and normalises to an array',
    ({ field, input }) => {
      const result = Question.safeParse({ ...base, [field]: input })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data[field]).toEqual([option('A')])
      }
    }
  )
})

describe('BaseContent variations', () => {
  const base = {
    id: 'https://remote.example/notes/1',
    type: 'Note' as const,
    attributedTo: 'https://remote.example/users/alice',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    content: 'test content',
    published: '2026-01-01T00:00:00Z'
  }

  it('accepts string URLs for replies, likes, and shares (NodeBB, PeerTube dialects)', () => {
    const result = Note.safeParse({
      ...base,
      replies: 'https://community.nodebb.org/comments/post/123/replies',
      likes: 'https://peertube.example/videos/watch/123/likes',
      shares: 'https://peertube.example/videos/watch/123/announces'
    })
    expect(result.success).toBe(true)
  })

  it('accepts array or link object for url', () => {
    const result = Note.safeParse({
      ...base,
      url: [
        { type: 'Link', href: 'https://example.com/post/1' },
        {
          type: 'Link',
          mediaType: 'video/mp4',
          href: 'https://example.com/video.mp4'
        }
      ]
    })
    expect(result.success).toBe(true)
  })
})

describe('VideoContent and ImageContent schemas', () => {
  it('preserves icon and focalPoint on VideoContent', () => {
    const parsed = VideoContent.safeParse({
      id: 'https://example.com/videos/1',
      type: 'Video',
      attributedTo: 'https://example.com/users/alice',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      published: '2026-01-01T00:00:00Z',
      url: 'https://example.com/video.mp4',
      mediaType: 'video/mp4',
      width: 1920,
      height: 1080,
      focalPoint: [0.5, -0.5],
      icon: {
        type: 'Image',
        url: 'https://example.com/thumb.jpg'
      }
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.focalPoint).toEqual([0.5, -0.5])
      expect(parsed.data.icon).toEqual({
        type: 'Image',
        url: 'https://example.com/thumb.jpg'
      })
    }
  })

  it('preserves focalPoint on ImageContent', () => {
    const parsed = ImageContent.safeParse({
      id: 'https://example.com/images/1',
      type: 'Image',
      attributedTo: 'https://example.com/users/alice',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      published: '2026-01-01T00:00:00Z',
      url: 'https://example.com/photo.jpg',
      mediaType: 'image/jpeg',
      focalPoint: [0.2, 0.8]
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.focalPoint).toEqual([0.2, 0.8])
    }
  })
})
