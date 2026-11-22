import { MAX_SEARCH_QUERY_TOKENS } from '@/lib/utils/searchQueryLimits'

import {
  SEARCH_HAS_VALUES,
  SEARCH_IS_VALUES,
  getSearchDayEnd,
  parseSearchQuery
} from './parseSearchQuery'

describe('parseSearchQuery', () => {
  it('reads plain words with hasOperators false and folds accents', () => {
    expect(parseSearchQuery('  Café   naïve  résumé  ')).toEqual({
      terms: ['cafe', 'naive', 'resume'],
      phrases: [],
      excluded: [],
      filters: [],
      scope: 'library',
      plainText: 'Café naïve résumé',
      hasOperators: false
    })
  })

  it('returns an empty parsed query for blank or punctuation-only input', () => {
    for (const input of ['', '   ', '-', '!!!']) {
      expect(parseSearchQuery(input)).toEqual({
        terms: [],
        phrases: [],
        excluded: [],
        filters: [],
        scope: 'library',
        plainText: '',
        hasOperators: false
      })
    }
  })

  it('keeps URLs without operators as plain text with hasOperators false', () => {
    expect(parseSearchQuery('https://example.com/@a')).toEqual({
      terms: ['https', 'example', 'com', 'a'],
      phrases: [],
      excluded: [],
      filters: [],
      scope: 'library',
      plainText: 'https://example.com/@a',
      hasOperators: false
    })
  })

  it('deduplicates folded terms in typed order', () => {
    expect(parseSearchQuery('cats CATS café cafe dogs cats')).toEqual({
      terms: ['cats', 'cafe', 'dogs'],
      phrases: [],
      excluded: [],
      filters: [],
      scope: 'library',
      plainText: 'cats CATS café cafe dogs cats',
      hasOperators: false
    })
  })

  it.each([
    {
      description: 'from:me',
      query: 'from:me',
      filter: { type: 'from', value: { kind: 'me' }, negated: false }
    },
    {
      description: 'case-insensitive FROM:ME',
      query: 'FROM:ME',
      filter: { type: 'from', value: { kind: 'me' }, negated: false }
    },
    {
      description: 'bare local username',
      query: 'from:alice',
      filter: {
        type: 'from',
        value: { kind: 'handle', username: 'alice', domain: null },
        negated: false
      }
    },
    {
      description: 'leading @ local username',
      query: 'from:@alice',
      filter: {
        type: 'from',
        value: { kind: 'handle', username: 'alice', domain: null },
        negated: false
      }
    },
    {
      description: 'full handle lowercases domain',
      query: 'From:Alice@Example.TEST',
      filter: {
        type: 'from',
        value: { kind: 'handle', username: 'Alice', domain: 'example.test' },
        negated: false
      }
    },
    {
      description: 'leading @ full handle',
      query: 'from:@alice.1@sub.example.test',
      filter: {
        type: 'from',
        value: {
          kind: 'handle',
          username: 'alice.1',
          domain: 'sub.example.test'
        },
        negated: false
      }
    },
    {
      description: 'negated from:me',
      query: '-from:me',
      filter: { type: 'from', value: { kind: 'me' }, negated: true }
    },
    {
      description: 'negated from:handle',
      query: '-FROM:@bob@remote.test',
      filter: {
        type: 'from',
        value: { kind: 'handle', username: 'bob', domain: 'remote.test' },
        negated: true
      }
    }
  ])('parses from operator ($description)', ({ query, filter }) => {
    expect(parseSearchQuery(query)).toEqual({
      terms: [],
      phrases: [],
      excluded: [],
      filters: [filter],
      scope: 'library',
      plainText: '',
      hasOperators: true
    })
  })

  it.each(SEARCH_HAS_VALUES)(
    'parses has:%s, case-insensitively and negated',
    (value) => {
      expect(parseSearchQuery(`has:${value}`).filters).toEqual([
        { type: 'has', value, negated: false }
      ])
      expect(parseSearchQuery(`HAS:${value.toUpperCase()}`).filters).toEqual([
        { type: 'has', value, negated: false }
      ])
      expect(parseSearchQuery(`-has:${value}`)).toEqual({
        terms: [],
        phrases: [],
        excluded: [],
        filters: [{ type: 'has', value, negated: true }],
        scope: 'library',
        plainText: '',
        hasOperators: true
      })
    }
  )

  it.each(SEARCH_IS_VALUES)(
    'parses is:%s, case-insensitively and negated',
    (value) => {
      expect(parseSearchQuery(`is:${value}`).filters).toEqual([
        { type: 'is', value, negated: false }
      ])
      expect(parseSearchQuery(`Is:${value.toUpperCase()}`).filters).toEqual([
        { type: 'is', value, negated: false }
      ])
      expect(parseSearchQuery(`-is:${value}`)).toEqual({
        terms: [],
        phrases: [],
        excluded: [],
        filters: [{ type: 'is', value, negated: true }],
        scope: 'library',
        plainText: '',
        hasOperators: true
      })
    }
  )

  it.each([
    {
      description: 'two-letter code',
      query: 'language:th',
      expected: { type: 'language', value: 'th', negated: false }
    },
    {
      description: 'mixed-case BCP 47 subtag',
      query: 'LANGUAGE:pt-BR',
      expected: { type: 'language', value: 'pt-br', negated: false }
    },
    {
      description: 'three-letter code with script',
      query: 'language:zho-Hant',
      expected: { type: 'language', value: 'zho-hant', negated: false }
    },
    {
      description: 'negated language',
      query: '-language:EN',
      expected: { type: 'language', value: 'en', negated: true }
    }
  ])('parses language operator ($description)', ({ query, expected }) => {
    expect(parseSearchQuery(query)).toEqual({
      terms: [],
      phrases: [],
      excluded: [],
      filters: [expected],
      scope: 'library',
      plainText: '',
      hasOperators: true
    })
  })

  it.each([
    {
      description: 'before date',
      query: 'before:2026-01-15',
      expected: {
        type: 'before',
        value: Date.UTC(2026, 0, 15),
        negated: false
      }
    },
    {
      description: 'after date uppercase name',
      query: 'AFTER:2026-03-01',
      expected: {
        type: 'after',
        value: Date.UTC(2026, 2, 1),
        negated: false
      }
    },
    {
      description: 'during leap day',
      query: 'During:2024-02-29',
      expected: {
        type: 'during',
        value: Date.UTC(2024, 1, 29),
        negated: false
      }
    },
    {
      description: 'negated before',
      query: '-before:2026-01-15',
      expected: {
        type: 'before',
        value: Date.UTC(2026, 0, 15),
        negated: true
      }
    },
    {
      description: 'negated after',
      query: '-after:2026-01-15',
      expected: {
        type: 'after',
        value: Date.UTC(2026, 0, 15),
        negated: true
      }
    },
    {
      description: 'negated during',
      query: '-during:2026-01-15',
      expected: {
        type: 'during',
        value: Date.UTC(2026, 0, 15),
        negated: true
      }
    }
  ])('parses date operator ($description)', ({ query, expected }) => {
    expect(parseSearchQuery(query)).toEqual({
      terms: [],
      phrases: [],
      excluded: [],
      filters: [expected],
      scope: 'library',
      plainText: '',
      hasOperators: true
    })
  })

  it('computes the UTC end of a search day', () => {
    expect(getSearchDayEnd(Date.UTC(2026, 0, 15))).toBe(Date.UTC(2026, 0, 16))
  })

  it('parses in:library and in:all as scope operators', () => {
    expect(parseSearchQuery('in:all')).toEqual({
      terms: [],
      phrases: [],
      excluded: [],
      filters: [],
      scope: 'all',
      plainText: '',
      hasOperators: true
    })
    expect(parseSearchQuery('IN:ALL in:library')).toEqual({
      terms: [],
      phrases: [],
      excluded: [],
      filters: [],
      scope: 'library',
      plainText: '',
      hasOperators: true
    })
  })

  it.each([
    {
      description: 'quoted phrase',
      query: '"grey heron"',
      expected: {
        terms: [],
        phrases: [['grey', 'heron']],
        excluded: [],
        plainText: 'grey heron'
      }
    },
    {
      description: 'unterminated quoted phrase',
      query: '"grey heron at dawn',
      expected: {
        terms: [],
        phrases: [['grey', 'heron', 'at', 'dawn']],
        excluded: [],
        plainText: 'grey heron at dawn'
      }
    },
    {
      description: 'accented quoted phrase',
      query: '"Café Crème"',
      expected: {
        terms: [],
        phrases: [['cafe', 'creme']],
        excluded: [],
        plainText: 'Café Crème'
      }
    },
    {
      description: 'excluded word',
      query: 'heron -pigeon',
      expected: {
        terms: ['heron'],
        phrases: [],
        excluded: [['pigeon']],
        plainText: 'heron'
      }
    },
    {
      description: 'excluded phrase',
      query: 'heron -"rock pigeon"',
      expected: {
        terms: ['heron'],
        phrases: [],
        excluded: [['rock', 'pigeon']],
        plainText: 'heron'
      }
    },
    {
      description: 'unterminated excluded phrase',
      query: '-"rock pigeon',
      expected: {
        terms: [],
        phrases: [],
        excluded: [['rock', 'pigeon']],
        plainText: ''
      }
    }
  ])('parses phrases and exclusions ($description)', ({ query, expected }) => {
    expect(parseSearchQuery(query)).toEqual({
      ...expected,
      filters: [],
      scope: 'library',
      hasOperators: true
    })
  })

  it.each([
    {
      description: 'unknown operator foo:bar',
      query: 'foo:bar',
      expected: {
        terms: ['foo', 'bar'],
        excluded: [],
        plainText: 'foo:bar',
        hasOperators: false
      }
    },
    {
      description: 'non-date before:yesterday',
      query: 'before:yesterday',
      expected: {
        terms: ['before', 'yesterday'],
        excluded: [],
        plainText: 'before:yesterday',
        hasOperators: false
      }
    },
    {
      description: 'invalid calendar day before:2026-02-30',
      query: 'before:2026-02-30',
      expected: {
        terms: ['before', '2026', '02', '30'],
        excluded: [],
        plainText: 'before:2026-02-30',
        hasOperators: false
      }
    },
    {
      description: 'URL in from:https://x',
      query: 'from:https://x',
      expected: {
        terms: ['from', 'https', 'x'],
        excluded: [],
        plainText: 'from:https://x',
        hasOperators: false
      }
    },
    {
      description: 'unknown scope in:other',
      query: 'in:other',
      expected: {
        terms: ['in', 'other'],
        excluded: [],
        plainText: 'in:other',
        hasOperators: false
      }
    },
    {
      description: 'negated scope -in:all',
      query: '-in:all',
      expected: {
        terms: [],
        excluded: [['in', 'all']],
        plainText: '',
        hasOperators: true
      }
    },
    {
      description: 'unknown has value',
      query: 'has:stickers',
      expected: {
        terms: ['has', 'stickers'],
        excluded: [],
        plainText: 'has:stickers',
        hasOperators: false
      }
    },
    {
      description: 'unknown is value',
      query: 'is:pinned',
      expected: {
        terms: ['is', 'pinned'],
        excluded: [],
        plainText: 'is:pinned',
        hasOperators: false
      }
    },
    {
      description: 'invalid language code',
      query: 'language:123',
      expected: {
        terms: ['language', '123'],
        excluded: [],
        plainText: 'language:123',
        hasOperators: false
      }
    }
  ])(
    'treats malformed operators as words ($description)',
    ({ query, expected }) => {
      expect(parseSearchQuery(query)).toEqual({
        ...expected,
        phrases: [],
        filters: [],
        scope: 'library'
      })
    }
  )

  it('collects only non-operator words and phrases in plainText', () => {
    expect(
      parseSearchQuery('from:me has:media "grey heron" dawn -pigeon -is:reply')
    ).toEqual({
      terms: ['dawn'],
      phrases: [['grey', 'heron']],
      excluded: [['pigeon']],
      filters: [
        { type: 'from', value: { kind: 'me' }, negated: false },
        { type: 'has', value: 'media', negated: false },
        { type: 'is', value: 'reply', negated: true }
      ],
      scope: 'library',
      plainText: 'grey heron dawn',
      hasOperators: true
    })
  })

  it('enforces MAX_SEARCH_QUERY_TOKENS across terms, phrases, exclusions and filters in typed order', () => {
    // 2 filters + 3-word phrase + 2-word exclusion + 4 terms = 11 tokens.
    // The next 2-word phrase would reach 13 (> 12) so it is dropped;
    // the trailing single-token filter reaches 12 and is kept;
    // the final term would reach 13 and is dropped.
    const parsed = parseSearchQuery(
      'from:me has:media "alpha beta gamma" -"delta epsilon" one two three four "five six" is:reply seven'
    )

    expect(parsed.filters).toEqual([
      { type: 'from', value: { kind: 'me' }, negated: false },
      { type: 'has', value: 'media', negated: false },
      { type: 'is', value: 'reply', negated: false }
    ])
    expect(parsed.phrases).toEqual([['alpha', 'beta', 'gamma']])
    expect(parsed.excluded).toEqual([['delta', 'epsilon']])
    expect(parsed.terms).toEqual(['one', 'two', 'three', 'four'])

    const totalConsumed =
      parsed.filters.length +
      parsed.terms.length +
      parsed.phrases.reduce((sum, phrase) => sum + phrase.length, 0) +
      parsed.excluded.reduce((sum, entry) => sum + entry.length, 0)
    expect(totalConsumed).toBe(MAX_SEARCH_QUERY_TOKENS)
  })

  it('caps plain distinct terms at MAX_SEARCH_QUERY_TOKENS without counting duplicates', () => {
    const words = Array.from(
      { length: MAX_SEARCH_QUERY_TOKENS + 3 },
      (_, index) => `word${index}`
    )
    const parsed = parseSearchQuery(`word0 word0 ${words.join(' ')}`)

    expect(parsed.terms).toEqual(words.slice(0, MAX_SEARCH_QUERY_TOKENS))
  })

  it('keeps repeated words in a phrase in order', () => {
    expect(parseSearchQuery('"bye bye now"').phrases).toEqual([
      ['bye', 'bye', 'now']
    ])
  })
})
