import {
  DEFAULT_POSTING_LANGUAGE,
  getPostingLanguage,
  parseLanguageCode
} from './postingLanguage'

describe('postingLanguage', () => {
  it.each(['en', 'fil', 'yue', 'zh-TW', 'pt_BR'])(
    'keeps %s as given',
    (code) => {
      expect(parseLanguageCode(` ${code} `)).toBe(code)
      expect(getPostingLanguage(code)).toBe(code)
    }
  )

  it.each([undefined, null, '', ' ', '12', 'e', 'english', '!@', 'en-'])(
    'rejects %s and falls back to the default',
    (code) => {
      expect(parseLanguageCode(code)).toBeNull()
      expect(getPostingLanguage(code)).toBe(DEFAULT_POSTING_LANGUAGE)
    }
  )
})
