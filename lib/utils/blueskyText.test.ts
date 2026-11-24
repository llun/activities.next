import {
  BLUESKY_MAX_GRAPHEMES,
  countBlueskyGraphemes
} from '@/lib/utils/blueskyText'

describe('countBlueskyGraphemes', () => {
  it('counts ASCII, multibyte scripts, combining marks, and ZWJ emoji as graphemes', () => {
    expect(countBlueskyGraphemes('')).toBe(0)
    expect(countBlueskyGraphemes('hello')).toBe(5)
    // Combining acute accent (2 UTF-16 code units, 1 grapheme).
    expect(countBlueskyGraphemes('e\u0301')).toBe(1)
    // ZWJ family emoji (11 UTF-16 code units, 1 grapheme).
    expect(countBlueskyGraphemes('👨‍👩‍👧‍👦')).toBe(1)
    // Thai with combining vowel + tone mark.
    expect(countBlueskyGraphemes('สวัสดี')).toBe(4)
    expect(countBlueskyGraphemes('🚀'.repeat(BLUESKY_MAX_GRAPHEMES))).toBe(300)
  })
})
