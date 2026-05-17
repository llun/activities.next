import { buildSearchTermPrefixes, normalizeSearchTokens } from './tokenize'

describe('search tokenization', () => {
  it('normalizes accents, punctuation, mentions, and hashtags into bounded tokens', () => {
    expect(
      normalizeSearchTokens('Café runner #Run @Alice@example.COM Café')
    ).toEqual(['cafe', 'runner', 'run', 'alice', 'example', 'com'])
  })

  it('builds deduplicated bounded prefixes for indexed terms', () => {
    expect(buildSearchTermPrefixes(['running', 'run'])).toEqual([
      'ru',
      'run',
      'runn',
      'runni',
      'runnin',
      'running'
    ])
  })
})
