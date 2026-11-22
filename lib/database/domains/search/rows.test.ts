import {
  foldSearchText,
  getSearchTokens,
  normalizeSearchText
} from '@/lib/database/domains/search/rows'
import {
  MAX_SEARCH_QUERY_TOKENS,
  MAX_SEARCH_TOKEN_LENGTH
} from '@/lib/utils/searchQueryLimits'

describe('foldSearchText', () => {
  it('lowercases and drops Latin accents', () => {
    expect(foldSearchText('Café')).toBe('cafe')
    expect(foldSearchText('ÉCOLE Ñandú')).toBe('ecole nandu')
  })

  it('folds full-width forms to ASCII', () => {
    expect(foldSearchText('ＡＢＣ')).toBe('abc')
  })

  it('folds compatibility ligatures', () => {
    expect(foldSearchText('ﬁne')).toBe('fine')
  })

  it('leaves scripts whose marks are part of the letter unchanged', () => {
    // Thai vowels and tone marks are not in the Combining Diacritical Marks
    // block, so they survive the fold.
    expect(foldSearchText('ที่นี่')).toBe('ที่นี่')
    // A voiced kana mark decomposes under NFKD but NFC puts it back together.
    expect(foldSearchText('が')).toBe('が')
    expect(Array.from(foldSearchText('が'))).toHaveLength(1)
    // Hangul syllables decompose to jamo and recompose under NFC.
    expect(foldSearchText('한국')).toBe('한국')
  })
})

describe('normalizeSearchText', () => {
  it('folds and collapses whitespace', () => {
    expect(normalizeSearchText('  Café   Crème  ')).toBe('cafe creme')
  })
})

describe('getSearchTokens', () => {
  it('folds and tokenizes accented text', () => {
    expect(getSearchTokens('ÉCOLE Ñandú')).toEqual(['ecole', 'nandu'])
  })

  it('keeps non-Latin scripts intact', () => {
    expect(getSearchTokens('Café 東京 runner_1')).toEqual([
      'cafe',
      '東京',
      'runner_1'
    ])
  })

  it('lowercases capitals that compatibility folding produces', () => {
    expect(getSearchTokens('𝐍𝐎𝐓 𝐀𝐍𝐃 ᴼᴿ Brand™')).toEqual([
      'not',
      'and',
      'or',
      'brandtm'
    ])
  })

  it('caps the number of tokens', () => {
    const many = Array.from(
      { length: MAX_SEARCH_QUERY_TOKENS + 5 },
      (_, index) => `term${index}`
    ).join(' ')
    expect(getSearchTokens(many)).toHaveLength(MAX_SEARCH_QUERY_TOKENS)
  })

  it('caps the length of each token', () => {
    expect(getSearchTokens('a'.repeat(10_000))).toEqual([
      'a'.repeat(MAX_SEARCH_TOKEN_LENGTH)
    ])
  })
})
