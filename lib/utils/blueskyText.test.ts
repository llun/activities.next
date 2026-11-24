import {
  BLUESKY_MAX_GRAPHEMES,
  BLUESKY_MAX_UTF8_BYTES,
  BLUESKY_TOO_LONG_MESSAGE,
  countBlueskyGraphemes,
  countBlueskyUtf8Bytes,
  getBlueskyReplyLengthState,
  isOverBlueskyLimit
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

describe('countBlueskyUtf8Bytes', () => {
  it('counts UTF-8 byte length accurately for ASCII and multibyte emoji', () => {
    expect(countBlueskyUtf8Bytes('hello')).toBe(5)
    // ZWJ family emoji is 25 UTF-8 bytes; 120 fits 3000 bytes, 121 exceeds it.
    expect(countBlueskyUtf8Bytes('👨‍👩‍👧‍👦'.repeat(120))).toBe(BLUESKY_MAX_UTF8_BYTES)
    expect(countBlueskyUtf8Bytes('👨‍👩‍👧‍👦'.repeat(121))).toBe(3025)
  })
})

describe('getBlueskyReplyLengthState', () => {
  it('enforces both the instance .length limit and Bluesky grapheme/byte limits', () => {
    expect(getBlueskyReplyLengthState('', 500)).toEqual({
      remaining: 300,
      overBlueskyLimit: false,
      overInstanceLimit: false,
      withinLimits: true,
      errorMessage: null
    })

    // Instance limit tighter than 300.
    expect(getBlueskyReplyLengthState('a'.repeat(201), 200)).toEqual({
      remaining: -1,
      overBlueskyLimit: false,
      overInstanceLimit: true,
      withinLimits: false,
      errorMessage: 'Text character limit of 200 exceeded'
    })

    // Over 300 graphemes but within instance limit.
    expect(getBlueskyReplyLengthState('a'.repeat(301), 500)).toEqual({
      remaining: -1,
      overBlueskyLimit: true,
      overInstanceLimit: false,
      withinLimits: false,
      errorMessage: BLUESKY_TOO_LONG_MESSAGE
    })

    // Within 300 graphemes (50) but over 500 UTF-16 code units (550).
    expect(getBlueskyReplyLengthState('👨‍👩‍👧‍👦'.repeat(50), 500)).toEqual({
      remaining: -50,
      overBlueskyLimit: false,
      overInstanceLimit: true,
      withinLimits: false,
      errorMessage: 'Text character limit of 500 exceeded'
    })

    // Within 300 graphemes (121) and within large instance limit (5000), but over 3000 UTF-8 bytes.
    expect(getBlueskyReplyLengthState('👨‍👩‍👧‍👦'.repeat(121), 5000)).toEqual({
      remaining: 179,
      overBlueskyLimit: true,
      overInstanceLimit: false,
      withinLimits: false,
      errorMessage: BLUESKY_TOO_LONG_MESSAGE
    })
  })
})

describe('isOverBlueskyLimit', () => {
  it('is over past 300 graphemes', () => {
    expect(isOverBlueskyLimit('a'.repeat(300))).toBe(false)
    expect(isOverBlueskyLimit('a'.repeat(301))).toBe(true)
    // 300 emoji are 300 graphemes but 1200 bytes: still within.
    expect(isOverBlueskyLimit('🚀'.repeat(300))).toBe(false)
  })

  it('is over past 3000 UTF-8 bytes even within 300 graphemes', () => {
    expect(isOverBlueskyLimit('👨‍👩‍👧‍👦'.repeat(120))).toBe(false)
    expect(isOverBlueskyLimit('👨‍👩‍👧‍👦'.repeat(121))).toBe(true)
  })
})
