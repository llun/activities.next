import { getEmojiFromTag, getMentionFromTag } from '@/lib/types/domain/tag'

const baseTag = {
  id: 'tag-1',
  statusId: 'status-1',
  createdAt: 0,
  updatedAt: 1700000000000
}

describe('getEmojiFromTag', () => {
  it('converts an emoji tag into an ActivityPub Emoji object', () => {
    const emoji = getEmojiFromTag({
      ...baseTag,
      type: 'emoji',
      name: ':blobcat:',
      value: 'https://example.com/blobcat.png'
    })
    expect(emoji).toEqual({
      type: 'Emoji',
      id: 'https://example.com/blobcat.png',
      name: ':blobcat:',
      updated: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      icon: {
        type: 'Image',
        url: 'https://example.com/blobcat.png'
      }
    })
  })

  it.each([
    { description: 'mention', type: 'mention' as const },
    { description: 'hashtag', type: 'hashtag' as const }
  ])('returns null for a $description tag', ({ type }) => {
    expect(
      getEmojiFromTag({
        ...baseTag,
        type,
        name: type === 'hashtag' ? '#tag' : '@user',
        value: 'https://example.com'
      })
    ).toBeNull()
  })
})

describe('getMentionFromTag', () => {
  it('returns null for an emoji tag so it is not mis-serialized as a Mention', () => {
    expect(
      getMentionFromTag({
        ...baseTag,
        type: 'emoji',
        name: ':blobcat:',
        value: 'https://example.com/blobcat.png'
      })
    ).toBeNull()
  })

  it('converts a hashtag tag, prefixing the name with #', () => {
    expect(
      getMentionFromTag({
        ...baseTag,
        type: 'hashtag',
        name: 'cats',
        value: 'https://example.com/tags/cats'
      })
    ).toEqual({
      type: 'Hashtag',
      name: '#cats',
      href: 'https://example.com/tags/cats'
    })
  })

  it('converts a mention tag', () => {
    expect(
      getMentionFromTag({
        ...baseTag,
        type: 'mention',
        name: '@user@example.com',
        value: 'https://example.com/users/user'
      })
    ).toEqual({
      type: 'Mention',
      name: '@user@example.com',
      href: 'https://example.com/users/user'
    })
  })
})
