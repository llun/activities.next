import { getEmojiTags } from '@/lib/utils/text/getEmojiTags'

describe('getEmojiTags', () => {
  const emojis = [
    { shortcode: 'blobcat', url: 'https://example.com/blobcat.png' },
    { shortcode: 'tada', url: 'https://example.com/tada.png' }
  ]

  it.each([
    { description: 'no shortcodes', text: 'hello world', expected: [] },
    {
      description: 'a single known shortcode',
      text: 'hi :blobcat:',
      expected: [
        { name: ':blobcat:', value: 'https://example.com/blobcat.png' }
      ]
    },
    {
      description: 'multiple known shortcodes',
      text: ':blobcat: party :tada:',
      expected: [
        { name: ':blobcat:', value: 'https://example.com/blobcat.png' },
        { name: ':tada:', value: 'https://example.com/tada.png' }
      ]
    },
    {
      description: 'ignores unknown shortcodes',
      text: 'unknown :nope: known :tada:',
      expected: [{ name: ':tada:', value: 'https://example.com/tada.png' }]
    },
    {
      description: 'deduplicates repeated shortcodes',
      text: ':tada: :tada: :tada:',
      expected: [{ name: ':tada:', value: 'https://example.com/tada.png' }]
    }
  ])('resolves $description', ({ text, expected }) => {
    expect(getEmojiTags(text, emojis)).toEqual(expected)
  })

  it('returns an empty list for empty text', () => {
    expect(getEmojiTags('', emojis)).toEqual([])
  })
})
