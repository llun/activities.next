import { getEmojiTags } from '@/lib/utils/text/getEmojiTags'

describe('getEmojiTags', () => {
  const emojis = [
    { shortcode: 'blobcat', url: 'https://example.com/blobcat.png' },
    { shortcode: 'tada', url: 'https://example.com/tada.png' },
    // A 1-char shortcode that exists in the set but must NOT be scanned, since
    // Mastodon's SCAN_RE requires a minimum length of 2.
    { shortcode: 'a', url: 'https://example.com/a.png' }
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
    },
    {
      description:
        'ignores shortcodes embedded inside a word (Mastodon boundary)',
      text: 'foo:tada:bar',
      expected: []
    },
    {
      description: 'matches a shortcode adjacent to punctuation',
      text: '(:tada:)',
      expected: [{ name: ':tada:', value: 'https://example.com/tada.png' }]
    },
    {
      description: 'ignores a 1-char shortcode (Mastodon requires >= 2 chars)',
      text: 'hi :a: there',
      expected: []
    }
  ])('resolves $description', ({ text, expected }) => {
    expect(getEmojiTags(text, emojis)).toEqual(expected)
  })

  it('returns an empty list for empty text', () => {
    expect(getEmojiTags('', emojis)).toEqual([])
  })
})
