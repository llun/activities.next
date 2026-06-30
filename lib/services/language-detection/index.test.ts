import {
  cleanTextForDetection,
  detectLanguage,
  detectLanguageFromHtml
} from './index'

const THAI_TEXT =
  'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร'
const ENGLISH_TEXT =
  'Hello, my name is John and I am a software developer working in Bangkok'

describe('cleanTextForDetection', () => {
  it.each([
    {
      description: 'strips http(s) URLs',
      input: `${ENGLISH_TEXT} https://example.com/some/path`,
      expected: ENGLISH_TEXT
    },
    {
      description: 'strips bare www URLs',
      input: `${ENGLISH_TEXT} www.example.com`,
      expected: ENGLISH_TEXT
    },
    {
      description: 'strips @mentions including remote @user@host form',
      input: `${ENGLISH_TEXT} @john @jane@example.social`,
      expected: ENGLISH_TEXT
    },
    {
      description: 'strips #hashtags',
      input: `${ENGLISH_TEXT} #golang #fediverse`,
      expected: ENGLISH_TEXT
    },
    {
      description: 'collapses whitespace left behind by stripped tokens',
      input: 'hello   https://x.com   world',
      expected: 'hello world'
    }
  ])('$description', ({ input, expected }) => {
    expect(cleanTextForDetection(input)).toBe(expected)
  })
})

describe('detectLanguage', () => {
  it.each([
    {
      description: 'detects Thai content',
      input: THAI_TEXT,
      expected: 'th'
    },
    {
      description: 'detects English content',
      input: ENGLISH_TEXT,
      expected: 'en'
    }
  ])('$description', ({ input, expected }) => {
    const result = detectLanguage(input)
    expect(result?.language).toBe(expected)
    expect(result?.confidence).toBeGreaterThan(0)
  })

  it.each([
    { description: 'null input', input: null },
    { description: 'undefined input', input: undefined },
    { description: 'empty string', input: '' },
    { description: 'very short text', input: 'ok' },
    { description: 'digits only', input: '55555' },
    {
      description: 'URL-only text (cleans to nothing)',
      input: 'https://example.com/some/very/long/path/here'
    },
    {
      description: 'mentions and hashtags only',
      input: '@john@example.social #golang #fediverse'
    }
  ])('returns null for $description', ({ input }) => {
    expect(detectLanguage(input)).toBeNull()
  })
})

describe('detectLanguageFromHtml', () => {
  it('strips HTML before detecting', () => {
    const result = detectLanguageFromHtml(`<p>${THAI_TEXT}</p>`)
    expect(result?.language).toBe('th')
  })

  it.each([
    { description: 'null input', input: null },
    { description: 'undefined input', input: undefined }
  ])('returns null for $description', ({ input }) => {
    expect(detectLanguageFromHtml(input)).toBeNull()
  })
})
