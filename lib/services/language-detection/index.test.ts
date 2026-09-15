import { logger } from '@/lib/utils/logger'

import {
  cleanTextForDetection,
  detectLanguage,
  detectLanguageFromHtml,
  normalizeTextForDetection,
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

const DUTCH_HEADLINE_1 =
  'Kabinet presenteert nieuwe plannen voor de woningmarkt'
const DUTCH_HEADLINE_2 =
  'Zware regen zorgt voor overlast in het zuiden van Nederland'
const DUTCH_HEADLINE_3 =
  'Het wordt vandaag zonnig, maar vanavond trekken buien over het land'
const DUTCH_HEADLINE_4 =
  'De politie heeft twee verdachten aangehouden na een overval op een juwelier in Rotterdam'
const DUTCH_HEADLINE_5 =
  'Onderzoekers ontdekken nieuwe diersoorten in de diepzee bij het Caribisch gebied'
const DUTCH_HEADLINE_6 =
  'De inflatie in Nederland is de afgelopen maand gedaald naar het laagste niveau in twee jaar'

// Helpers to generate styled Unicode variants
const toMathBold = (str: string) =>
  str.replace(/[A-Za-z0-9]/g, (c) => {
    const code = c.charCodeAt(0)
    if (code >= 65 && code <= 90)
      return String.fromCodePoint(0x1d400 + code - 65)
    if (code >= 97 && code <= 122)
      return String.fromCodePoint(0x1d41a + code - 97)
    if (code >= 48 && code <= 57)
      return String.fromCodePoint(0x1d7ce + code - 48)
    return c
  })

const toMathItalic = (str: string) =>
  str.replace(/[A-Za-z]/g, (c) => {
    const code = c.charCodeAt(0)
    if (code >= 65 && code <= 90)
      return String.fromCodePoint(0x1d434 + code - 65)
    if (c === 'h') return 'ℎ'
    if (code >= 97 && code <= 122)
      return String.fromCodePoint(0x1d44e + code - 97)
    return c
  })

const toMathSansBold = (str: string) =>
  str.replace(/[A-Za-z0-9]/g, (c) => {
    const code = c.charCodeAt(0)
    if (code >= 65 && code <= 90)
      return String.fromCodePoint(0x1d5d4 + code - 65)
    if (code >= 97 && code <= 122)
      return String.fromCodePoint(0x1d5ee + code - 97)
    if (code >= 48 && code <= 57)
      return String.fromCodePoint(0x1d7ec + code - 48)
    return c
  })

const toMathBoldItalic = (str: string) =>
  str.replace(/[A-Za-z]/g, (c) => {
    const code = c.charCodeAt(0)
    if (code >= 65 && code <= 90)
      return String.fromCodePoint(0x1d468 + code - 65)
    if (code >= 97 && code <= 122)
      return String.fromCodePoint(0x1d482 + code - 97)
    return c
  })

const toFullwidth = (str: string) =>
  str
    .replace(/[!-~]/g, (c) => String.fromCodePoint(c.charCodeAt(0) + 0xfee0))
    .replace(/ /g, '　')

const toHtmlEntities = (str: string) =>
  [...str]
    .map((c) => {
      const cp = c.codePointAt(0) ?? 0
      return cp > 127 ? `&#x${cp.toString(16)};` : c
    })
    .join('')

describe('normalizeTextForDetection', () => {
  it('normalizes mathematical bold characters to ASCII', () => {
    expect(normalizeTextForDetection('𝗞𝗮𝗯𝗶𝗻𝗲𝘁')).toBe('Kabinet')
  })

  it('normalizes fullwidth characters to standard width', () => {
    expect(normalizeTextForDetection('Ｋａｂｉｎｅｔ')).toBe('Kabinet')
  })

  it('preserves meaningful diacritics', () => {
    expect(normalizeTextForDetection('België café überhaupt')).toBe(
      'België café überhaupt'
    )
  })

  it('composes combining marks into precomposed characters', () => {
    expect(normalizeTextForDetection('Belgie\u0308')).toBe('België')
  })
})

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
    },
    {
      description: 'normalizes mathematical styled text to plain text',
      input: `${toMathBold('Hello')} world`,
      expected: 'Hello world'
    }
  ])('$description', ({ input, expected }) => {
    expect(cleanTextForDetection(input)).toBe(expected)
  })
})

describe('detectLanguage', () => {
  describe('plain Dutch headlines', () => {
    it.each([
      { description: 'headline 1', input: DUTCH_HEADLINE_1 },
      { description: 'headline 2', input: DUTCH_HEADLINE_2 },
      { description: 'headline 3', input: DUTCH_HEADLINE_3 },
      { description: 'headline 4', input: DUTCH_HEADLINE_4 },
      { description: 'headline 5', input: DUTCH_HEADLINE_5 },
      { description: 'headline 6', input: DUTCH_HEADLINE_6 }
    ])('detects Dutch in $description', ({ input }) => {
      const result = detectLanguage(input)
      expect(result?.language).toBe('nl')
      expect(result?.confidence).toBeGreaterThan(0.5)
    })
  })

  describe('styled Dutch variants', () => {
    it.each([
      {
        description: 'mathematical bold',
        input: toMathBold(DUTCH_HEADLINE_1)
      },
      {
        description: 'mathematical italic',
        input: toMathItalic(DUTCH_HEADLINE_2)
      },
      {
        description: 'sans-serif bold',
        input: toMathSansBold(DUTCH_HEADLINE_3)
      },
      {
        description: 'bold italic',
        input: toMathBoldItalic(DUTCH_HEADLINE_4)
      },
      {
        description: 'fullwidth letters',
        input: toFullwidth(DUTCH_HEADLINE_5)
      },
      {
        description: 'mixed styled and plain text',
        input: `🚨 ${toMathSansBold('Breaking:')} Kabinet presenteert ${toMathItalic('nieuwe plannen')} voor de woningmarkt`
      }
    ])('detects Dutch in $description', ({ input }) => {
      const result = detectLanguage(input)
      expect(result?.language).toBe('nl')
      expect(result?.confidence).toBeGreaterThan(0.5)
    })
  })

  describe('Dutch with social tokens, accents, and combining marks', () => {
    it('detects Dutch when URLs, mentions, and hashtags are present', () => {
      const input = `${DUTCH_HEADLINE_1} @ministerie @nos #woningmarkt #nieuws https://rijksoverheid.nl/nieuws`
      const result = detectLanguage(input)
      expect(result?.language).toBe('nl')
    })

    it('detects Dutch with accented characters', () => {
      const input =
        'In België organiseert het café een reünie voor de bevolking van de gemeente'
      const result = detectLanguage(input)
      expect(result?.language).toBe('nl')
    })

    it('detects Dutch with decomposed combining marks', () => {
      const input =
        'In Belgie\u0308 organiseert het cafe\u0301 een reu\u0308nie voor de bevolking van de gemeente'
      const result = detectLanguage(input)
      expect(result?.language).toBe('nl')
    })
  })

  describe('short Dutch and conversational text', () => {
    it.each([
      {
        description: 'farewell with wishes',
        input: 'Tot ziens en een fijne dag verder gewenst!'
      },
      {
        description: 'thank you note',
        input: 'Dank je wel voor alle goede hulp vandaag.'
      },
      {
        description: 'question',
        input: 'Wat is dit eigenlijk voor een vreemd bericht?'
      },
      {
        description: 'confirmation',
        input: 'Ja, dat klopt inderdaad helemaal volgens mij.'
      },
      {
        description: 'polite refusal',
        input: 'Nee bedankt, ik hoef er echt niets van te weten.'
      }
    ])('detects Dutch in $description', ({ input }) => {
      const result = detectLanguage(input)
      expect(result?.language).toBe('nl')
      expect(result?.confidence).toBeGreaterThan(0.5)
    })
  })

  describe('multilingual control set', () => {
    it.each([
      {
        description: 'English text',
        input: ENGLISH_TEXT,
        expected: 'en'
      },
      {
        description: 'mathematical bold English text',
        input: toMathBold(ENGLISH_TEXT),
        expected: 'en'
      },
      {
        description: 'Thai text',
        input: THAI_TEXT,
        expected: 'th'
      },
      {
        description: 'German text',
        input:
          'Die Bundesregierung stellt neue Pläne für den Wohnungsmarkt vor',
        expected: 'de'
      },
      {
        description: 'French text',
        input:
          'Le gouvernement présente de nouveaux plans pour le marché du logement',
        expected: 'fr'
      },
      {
        description: 'Spanish text',
        input:
          'El gobierno presenta nuevos planes para el mercado de la vivienda',
        expected: 'es'
      },
      {
        description: 'Italian text',
        input:
          'Il governo presenta nuovi piani per il mercato immobiliare oggi',
        expected: 'it'
      }
    ])('detects $expected for $description', ({ input, expected }) => {
      const result = detectLanguage(input)
      expect(result?.language).toBe(expected)
      expect(result?.confidence).toBeGreaterThan(0.5)
    })
  })

  describe('languages supported by tinyld but absent from ELD', () => {
    it('detects Khmer via fallback', () => {
      const input =
        'រដ្ឋាភិបាលបានប្រកាសផែនការថ្មីដើម្បីដោះស្រាយបញ្ហាផ្ទះសម្បែងនៅក្នុងរាជធានីភ្នំពេញ'
      const result = detectLanguage(input)
      expect(result?.language).toBe('km')
    })

    it('detects Burmese via fallback', () => {
      const input =
        'အစိုးရသည် အိမ်ရာအကျပ်အတည်းကို ဖြေရှင်းရန် စီမံကိန်းအသစ်တစ်ခုကို ကြေညာခဲ့သည်'
      const result = detectLanguage(input)
      expect(result?.language).toBe('my')
    })

    it('detects Indonesian without declared metadata via tinyld disambiguation', () => {
      const input =
        'Pemerintah mengumumkan rencana baru untuk mengatasi krisis perumahan di kota-kota besar seluruh Indonesia'
      const result = detectLanguage(input)
      expect(result?.language).toBe('id')
    })

    it('does not allow ELD prediction to override declared Indonesian metadata', () => {
      const input =
        'Pemerintah Indonesia membangun ibukota nusantara baru di pulau Kalimantan'
      const result = detectLanguage(input, { declaredLanguage: 'id' })
      expect(result?.language).toBe('id')
    })

    it('preserves Malay when explicitly declared', () => {
      const input =
        'Kerajaan membentangkan pelan baharu untuk menangani krisis perumahan di bandar-bandar utama seluruh negara'
      const result = detectLanguage(input, { declaredLanguage: 'ms' })
      expect(result?.language).toBe('ms')
    })

    it('does not allow ELD to override declared metadata for an unsupported language when tinyld does not confirm it', () => {
      // Text declared as Esperanto ('eo' - absent in ELD), where ELD might guess another language
      const input =
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor'
      const result = detectLanguage(input, { declaredLanguage: 'eo' })
      // Returns null rather than a wrong accepted guess from ELD
      expect(result).toBeNull()
    })
  })

  describe('length boundaries and normalization', () => {
    it('evaluates length after normalization (rejecting short styled text)', () => {
      // 10 styled letters: 20 code units before normalization, but only 10 chars after NFKC
      const shortStyled = toMathBold('Kort bericht')
      expect(shortStyled.length).toBeGreaterThanOrEqual(20)
      expect(detectLanguage(shortStyled)).toBeNull()
    })

    it('accepts text that meets minimum length after normalization', () => {
      // 20+ chars after normalization
      const longStyled = toMathBold(DUTCH_HEADLINE_1)
      expect(detectLanguage(longStyled)?.language).toBe('nl')
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
      },
      {
        description: 'emoji only',
        input: '😀😃😄😁😆😅😂🤣🥲☺️😊😇🙂🙃😉😌'
      }
    ])('returns null for $description', ({ input }) => {
      expect(detectLanguage(input)).toBeNull()
    })
  })
})

describe('detectLanguageFromHtml', () => {
  it('strips HTML and decodes HTML entities before detecting', () => {
    const html = `<p>${toHtmlEntities(toMathBold(DUTCH_HEADLINE_1))}</p>`
    const result = detectLanguageFromHtml(html)
    expect(result?.language).toBe('nl')
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
      text: DUTCH_HEADLINE_1
    })

    expect(database.setDetectedLanguage).toHaveBeenCalledWith({
      statusId: 'status-1',
      language: 'nl',
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
      text: `<p>${DUTCH_HEADLINE_2}</p>`,
      html: true
    })

    expect(database.setDetectedLanguage).toHaveBeenCalledWith({
      statusId: 'status-1',
      language: 'nl',
      confidence: expect.any(Number)
    })
  })

  it('passes declaredLanguage to avoid overriding unsupported metadata', async () => {
    const database = createStore()
    await persistDetectedLanguage({
      database,
      statusId: 'status-1',
      text: 'Pemerintah Indonesia membangun ibukota nusantara baru di pulau Kalimantan',
      declaredLanguage: 'id'
    })

    expect(database.setDetectedLanguage).toHaveBeenCalledWith({
      statusId: 'status-1',
      language: 'id',
      confidence: expect.any(Number)
    })
  })
})
