import {
  getCustomEmojiShortcode,
  isUnicodeEmojiReaction
} from '@/lib/services/reactions/reactionName'

describe('isUnicodeEmojiReaction', () => {
  it.each([
    { description: 'a plain emoji', value: '🔥' },
    { description: 'an emoji with a variation selector', value: '❤️' },
    { description: 'a skin-toned emoji', value: '👍🏽' },
    { description: 'a flag (regional indicator pair)', value: '🇹🇭' },
    { description: 'a ZWJ family sequence', value: '👨‍👩‍👧‍👦' },
    { description: 'a keycap', value: '1️⃣' }
  ])('accepts $description', ({ value }) => {
    expect(isUnicodeEmojiReaction(value)).toBeTrue()
  })

  it.each([
    { description: 'two emoji', value: '🔥🔥' },
    { description: 'an empty string', value: '' },
    { description: 'a bare letter', value: 'a' },
    { description: 'a bare digit', value: '5' },
    { description: 'a shortcode', value: 'partyparrot' },
    { description: 'a colon-wrapped shortcode', value: ':partyparrot:' },
    { description: 'an emoji with trailing text', value: '🔥x' }
  ])('rejects $description', ({ value }) => {
    expect(isUnicodeEmojiReaction(value)).toBeFalse()
  })
})

describe('getCustomEmojiShortcode', () => {
  it.each([
    {
      description: 'a colon-wrapped shortcode',
      value: ':blobcat:',
      expected: 'blobcat'
    },
    { description: 'a bare shortcode', value: 'blobcat', expected: 'blobcat' },
    {
      description: 'a shortcode with digits and underscores',
      value: ':blob_cat_2:',
      expected: 'blob_cat_2'
    }
  ])('reads $description', ({ value, expected }) => {
    expect(getCustomEmojiShortcode(value)).toBe(expected)
  })

  it.each([
    { description: 'a unicode emoji', value: '🔥' },
    { description: 'an empty string', value: '' },
    { description: 'bare colons', value: '::' },
    {
      description: 'a remote namespaced shortcode',
      value: 'blobcat@remote.test'
    },
    { description: 'a shortcode with a space', value: 'blob cat' },
    { description: 'a shortcode with a hyphen', value: 'blob-cat' }
  ])('returns null for $description', ({ value }) => {
    expect(getCustomEmojiShortcode(value)).toBeNull()
  })
})
