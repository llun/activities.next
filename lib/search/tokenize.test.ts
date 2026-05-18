import { buildSearchTermPrefixes, normalizeSearchTokens } from './tokenize'

describe('search tokenization', () => {
  it('normalizes accents, punctuation, mentions, and hashtags into bounded tokens', () => {
    expect(
      normalizeSearchTokens('Café runner #Run @Alice@example.COM Café')
    ).toEqual(['cafe', 'runner', 'run', 'alice', 'example', 'com'])
  })

  it('strips html tags before tokenizing status and profile text', () => {
    expect(
      normalizeSearchTokens('  <p>Hello <strong>trail</strong><br>crew</p>  ')
    ).toEqual(['hello', 'trail', 'crew'])
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
