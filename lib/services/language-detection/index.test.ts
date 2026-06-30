import { logger } from '@/lib/utils/logger'

import {
  cleanTextForDetection,
  detectLanguage,
  detectLanguageFromHtml,
  persistDetectedLanguage
} from './index'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn()
  }
}))

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

describe('persistDetectedLanguage', () => {
  const createStore = () => ({
    setDetectedLanguage: vi.fn().mockResolvedValue(undefined),
    clearDetectedLanguage: vi.fn().mockResolvedValue(undefined)
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs and swallows a database failure instead of throwing', async () => {
    const database = createStore()
    database.setDetectedLanguage.mockRejectedValue(new Error('connection lost'))

    await expect(
      persistDetectedLanguage({
        database,
        statusId: 'status-1',
        text: THAI_TEXT
      })
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      { error: expect.any(Error), statusId: 'status-1' },
      'Failed to persist detected language'
    )
  })

  it('sets the detected language when detection succeeds', async () => {
    const database = createStore()
    await persistDetectedLanguage({
      database,
      statusId: 'status-1',
      text: THAI_TEXT
    })

    expect(database.setDetectedLanguage).toHaveBeenCalledWith({
      statusId: 'status-1',
      language: 'th',
      confidence: expect.any(Number)
    })
    expect(database.clearDetectedLanguage).not.toHaveBeenCalled()
  })

  it('clears any previous detection when re-detection is inconclusive', async () => {
    const database = createStore()
    await persistDetectedLanguage({
      database,
      statusId: 'status-1',
      text: 'ok'
    })

    expect(database.clearDetectedLanguage).toHaveBeenCalledWith({
      statusId: 'status-1'
    })
    expect(database.setDetectedLanguage).not.toHaveBeenCalled()
  })

  it('strips HTML before detecting when html is true', async () => {
    const database = createStore()
    await persistDetectedLanguage({
      database,
      statusId: 'status-1',
      text: `<p>${THAI_TEXT}</p>`,
      html: true
    })

    expect(database.setDetectedLanguage).toHaveBeenCalledWith({
      statusId: 'status-1',
      language: 'th',
      confidence: expect.any(Number)
    })
  })
})
