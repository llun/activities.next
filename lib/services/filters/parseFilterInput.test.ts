import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseFilterCreateInput,
  parseFilterUpdateInput,
  parseKeywordCreateInput,
  parseKeywordUpdateInput,
  parseStatusCreateInput,
  parseV1FilterCreateInput,
  parseV1FilterUpdateInput
} from '@/lib/services/filters/parseFilterInput'

const NOW = 1_700_000_000_000

const formRequest = (entries: [string, string][]) =>
  new NextRequest('https://llun.test/api/v2/filters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(entries).toString()
  })

// Synthetic NextRequest bodies don't parse multipart, so stub formData().
const multipartRequest = (form: FormData) => {
  const request = new NextRequest('https://llun.test/api/v2/filters', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=----test' }
  })
  Object.defineProperty(request, 'formData', {
    value: vi.fn().mockResolvedValue(form)
  })
  return request
}

describe('parseFilterBody', () => {
  it('parses urlencoded bodies including repeated context[] keys', async () => {
    const req = new NextRequest('https://llun.test/api/v1/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([
        ['phrase', 'taboo'],
        ['context[]', 'home'],
        ['context[]', 'public'],
        ['irreversible', 'true']
      ]).toString()
    })

    await expect(parseFilterBody(req)).resolves.toEqual({
      phrase: 'taboo',
      context: ['home', 'public'],
      irreversible: 'true'
    })
  })

  it('parses urlencoded keywords_attributes for the v2 routes', async () => {
    const req = new NextRequest('https://llun.test/api/v2/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([
        ['title', 'My filter'],
        ['context[]', 'home'],
        ['keywords_attributes[0][keyword]', 'taboo'],
        ['keywords_attributes[0][whole_word]', 'true']
      ]).toString()
    })

    await expect(parseFilterBody(req)).resolves.toEqual({
      title: 'My filter',
      context: ['home'],
      keywords_attributes: [{ keyword: 'taboo', whole_word: 'true' }]
    })
  })
})

describe('parseFilterBody (additional content types)', () => {
  it.each(['application/json', 'text/json'])(
    'parses a %s body as JSON',
    async (contentType) => {
      const req = new NextRequest('https://llun.test/api/v2/filters', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: JSON.stringify({ title: 'T', context: ['home'] })
      })

      await expect(parseFilterBody(req)).resolves.toEqual({
        title: 'T',
        context: ['home']
      })
    }
  )

  it('treats an empty JSON body as an empty object', async () => {
    const req = new NextRequest('https://llun.test/api/v2/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    await expect(parseFilterBody(req)).resolves.toEqual({})
  })

  it('rejects malformed JSON so the route can answer 422', async () => {
    const req = new NextRequest('https://llun.test/api/v2/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{'
    })

    await expect(parseFilterBody(req)).rejects.toThrow()
  })

  it('parses multipart bodies and skips file uploads', async () => {
    const form = new FormData()
    form.append('title', 'Multipart')
    form.append('context', 'home')
    form.append('context', 'public')
    form.append('attachment', new File(['x'], 'x.txt'))

    await expect(parseFilterBody(multipartRequest(form))).resolves.toEqual({
      title: 'Multipart',
      context: ['home', 'public']
    })
  })

  it('accepts a bare context key as well as context[]', async () => {
    const req = formRequest([
      ['context', 'home'],
      ['context[]', 'thread']
    ])

    await expect(parseFilterBody(req)).resolves.toEqual({
      context: ['home', 'thread']
    })
  })

  it('orders indexed keywords_attributes by index, not arrival order', async () => {
    const req = formRequest([
      ['keywords_attributes[1][keyword]', 'second'],
      ['keywords_attributes[0][keyword]', 'first']
    ])

    await expect(parseFilterBody(req)).resolves.toEqual({
      keywords_attributes: [{ keyword: 'first' }, { keyword: 'second' }]
    })
  })

  it('splits unindexed keywords_attributes[][...] into a new record when a field repeats', async () => {
    const req = formRequest([
      ['keywords_attributes[][keyword]', 'one'],
      ['keywords_attributes[][whole_word]', 'true'],
      ['keywords_attributes[][keyword]', 'two'],
      ['keywords_attributes[][whole_word]', 'false']
    ])

    await expect(parseFilterBody(req)).resolves.toEqual({
      keywords_attributes: [
        { keyword: 'one', whole_word: 'true' },
        { keyword: 'two', whole_word: 'false' }
      ]
    })
  })
})

describe('parseFilterCreateInput', () => {
  it('applies defaults: warn action, no expiry, no keywords', () => {
    expect(
      parseFilterCreateInput({ title: '  Spam  ', context: ['home'] }, NOW)
    ).toEqual({
      title: 'Spam',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: []
    })
  })

  it('keeps an explicit filter_action', () => {
    expect(
      parseFilterCreateInput(
        { title: 'T', context: ['home'], filter_action: 'blur' },
        NOW
      )
    ).toMatchObject({ filterAction: 'blur' })
  })

  it('drops unknown context names but keeps the valid ones', () => {
    expect(
      parseFilterCreateInput(
        { title: 'T', context: ['home', 'bogus', 42, 'thread'] },
        NOW
      )
    ).toMatchObject({ context: ['home', 'thread'] })
  })

  it('normalizes keywords: trims, dedupes, skips blanks and _destroy entries, coerces whole_word', () => {
    expect(
      parseFilterCreateInput(
        {
          title: 'T',
          context: ['home'],
          keywords_attributes: [
            { keyword: ' alpha ', whole_word: 'yes' },
            { keyword: 'alpha', whole_word: true },
            { keyword: '   ' },
            { whole_word: true },
            { keyword: 'gone', _destroy: '1' },
            { keyword: 'beta', whole_word: 'off' },
            { keyword: 'gamma', whole_word: 1 }
          ]
        },
        NOW
      )?.keywords
    ).toEqual([
      { keyword: 'alpha', wholeWord: true },
      { keyword: 'beta', wholeWord: false },
      { keyword: 'gamma', wholeWord: true }
    ])
  })

  it.each([
    { description: 'a missing title', body: { context: ['home'] } },
    { description: 'a blank title', body: { title: '  ', context: ['home'] } },
    {
      description: 'a title over 255 characters',
      body: { title: 'x'.repeat(256), context: ['home'] }
    },
    { description: 'a missing context', body: { title: 'T' } },
    { description: 'an empty context', body: { title: 'T', context: [] } },
    {
      description: 'a context with only unknown values',
      body: { title: 'T', context: ['bogus'] }
    },
    {
      description: 'an unknown filter_action',
      body: { title: 'T', context: ['home'], filter_action: 'delete' }
    },
    {
      description: 'a keyword over 100 characters',
      body: {
        title: 'T',
        context: ['home'],
        keywords_attributes: [{ keyword: 'x'.repeat(101) }]
      }
    },
    { description: 'a null body', body: null },
    { description: 'a string body', body: 'title=T' }
  ])('rejects $description', ({ body }) => {
    expect(parseFilterCreateInput(body, NOW)).toBeNull()
  })

  describe('expiry', () => {
    const parseExpiry = (extra: Record<string, unknown>) =>
      parseFilterCreateInput({ title: 'T', context: ['home'], ...extra }, NOW)

    it.each([
      {
        description: 'a number of seconds',
        expires_in: 60,
        expected: NOW + 60_000
      },
      {
        description: 'a numeric string',
        expires_in: '90',
        expected: NOW + 90_000
      },
      {
        description: 'fractional seconds floored',
        expires_in: 1.9,
        expected: NOW + 1_000
      },
      {
        description: 'a negative value clamped to now',
        expires_in: -50,
        expected: NOW
      },
      { description: 'null (never expires)', expires_in: null, expected: null },
      { description: 'an empty string', expires_in: '', expected: null },
      { description: 'whitespace only', expires_in: '   ', expected: null }
    ])('resolves expires_in as $description', ({ expires_in, expected }) => {
      expect(parseExpiry({ expires_in })?.expiresAt).toBe(expected)
    })

    it.each([
      {
        description: 'an ISO date string',
        expires_at: '2030-01-01T00:00:00.000Z',
        expected: Date.parse('2030-01-01T00:00:00.000Z')
      },
      { description: 'null', expires_at: null, expected: null },
      { description: 'an empty string', expires_at: '  ', expected: null }
    ])('resolves expires_at as $description', ({ expires_at, expected }) => {
      expect(parseExpiry({ expires_at })?.expiresAt).toBe(expected)
    })

    it('prefers expires_in over expires_at when both are sent', () => {
      expect(
        parseExpiry({ expires_in: 10, expires_at: '2030-01-01T00:00:00Z' })
          ?.expiresAt
      ).toBe(NOW + 10_000)
    })

    it.each([
      {
        description: 'a non-numeric expires_in',
        extra: { expires_in: 'soon' }
      },
      {
        description: 'an out-of-range expires_in',
        extra: { expires_in: 99_999_999_999_999 }
      },
      {
        description: 'an unparseable expires_at',
        extra: { expires_at: 'tomorrow' }
      },
      {
        description: 'an expires_at beyond the Date range',
        extra: { expires_at: '+275761-01-01T00:00:00Z' }
      },
      {
        description: 'a numeric expires_at',
        extra: { expires_at: 1_800_000_000 }
      }
    ])('rejects $description', ({ extra }) => {
      expect(parseExpiry(extra)).toBeNull()
    })
  })
})

describe('parseFilterUpdateInput', () => {
  it('leaves every field undefined for an empty body so nothing is overwritten', () => {
    expect(parseFilterUpdateInput({}, NOW)).toEqual({
      title: undefined,
      context: undefined,
      filterAction: undefined,
      expiresAt: undefined,
      keywords: undefined
    })
  })

  it('returns only the fields that were sent, trimmed', () => {
    expect(
      parseFilterUpdateInput(
        { title: ' New ', filter_action: 'hide', expires_in: 5 },
        NOW
      )
    ).toEqual({
      title: 'New',
      context: undefined,
      filterAction: 'hide',
      expiresAt: NOW + 5_000,
      keywords: undefined
    })
  })

  it.each([
    ['null', null],
    ['a string', 'title=New'],
    ['a number', 5]
  ])('treats %s as an empty update', (_, body) => {
    expect(parseFilterUpdateInput(body, NOW)).toMatchObject({
      title: undefined,
      keywords: undefined
    })
  })

  it('maps expires_at null to a cleared expiry', () => {
    expect(parseFilterUpdateInput({ expires_at: null }, NOW)).toMatchObject({
      expiresAt: null
    })
  })

  it.each([
    { description: 'a blank title', body: { title: '   ' } },
    { description: 'an empty context', body: { context: [] } },
    { description: 'only unknown context values', body: { context: ['nope'] } },
    {
      description: 'an unknown filter_action',
      body: { filter_action: 'nuke' }
    },
    { description: 'an unparseable expiry', body: { expires_in: 'later' } }
  ])('rejects $description', ({ body }) => {
    expect(parseFilterUpdateInput(body, NOW)).toBeNull()
  })

  it('maps keyword changes: edits by id, additions, and removals', () => {
    expect(
      parseFilterUpdateInput(
        {
          keywords_attributes: [
            { id: 'k1', keyword: ' renamed ', whole_word: 'true' },
            { keyword: 'added' },
            { id: 'k2', _destroy: 'true' },
            { id: 'k3', _destroy: 'false' },
            { keyword: 'never-existed', _destroy: true },
            { id: 'k4', keyword: '   ' }
          ]
        },
        NOW
      )?.keywords
    ).toEqual([
      { id: 'k1', keyword: 'renamed', wholeWord: true },
      { keyword: 'added' },
      { id: 'k2', _destroy: true },
      { id: 'k3', _destroy: false },
      { id: 'k4' }
    ])
  })
})

describe('parseKeywordCreateInput', () => {
  it('trims the keyword and defaults whole_word to false', () => {
    expect(parseKeywordCreateInput({ keyword: '  taboo ' })).toEqual({
      keyword: 'taboo',
      wholeWord: false
    })
  })

  it.each([
    [true, true],
    ['on', true],
    ['TRUE', true],
    [1, true],
    [0, false],
    ['false', false],
    ['no', false]
  ])('coerces whole_word %j to %s', (value, expected) => {
    expect(
      parseKeywordCreateInput({ keyword: 'k', whole_word: value })?.wholeWord
    ).toBe(expected)
  })

  it.each([
    { description: 'a missing keyword', body: {} },
    { description: 'a blank keyword', body: { keyword: '   ' } },
    {
      description: 'a keyword over 100 characters',
      body: { keyword: 'x'.repeat(101) }
    },
    { description: 'a non-string keyword', body: { keyword: 5 } },
    { description: 'a null body', body: null }
  ])('rejects $description', ({ body }) => {
    expect(parseKeywordCreateInput(body)).toBeNull()
  })
})

describe('parseKeywordUpdateInput', () => {
  it('returns an empty change for an empty or null body', () => {
    expect(parseKeywordUpdateInput({})).toEqual({})
    expect(parseKeywordUpdateInput(null)).toEqual({})
  })

  it('returns only the fields sent, with the keyword trimmed', () => {
    expect(
      parseKeywordUpdateInput({ keyword: ' new ', whole_word: '1' })
    ).toEqual({ keyword: 'new', wholeWord: true })
    expect(parseKeywordUpdateInput({ whole_word: false })).toEqual({
      wholeWord: false
    })
  })

  it('ignores a blank keyword instead of clearing it', () => {
    expect(parseKeywordUpdateInput({ keyword: '   ' })).toEqual({})
  })

  it('rejects a keyword over 100 characters', () => {
    expect(parseKeywordUpdateInput({ keyword: 'x'.repeat(101) })).toBeNull()
  })
})

describe('parseStatusCreateInput', () => {
  it('returns the status id as sent', () => {
    expect(parseStatusCreateInput({ status_id: 'abc123' })).toBe('abc123')
  })

  it.each([
    { description: 'a missing status_id', body: {} },
    { description: 'an empty status_id', body: { status_id: '' } },
    { description: 'a non-string status_id', body: { status_id: 12 } },
    {
      description: 'a status_id over 2048 characters',
      body: { status_id: 'x'.repeat(2049) }
    },
    { description: 'a null body', body: null }
  ])('rejects $description', ({ body }) => {
    expect(parseStatusCreateInput(body)).toBeNull()
  })
})

describe('parseV1FilterCreateInput', () => {
  it('parses a full body, trims the phrase and applies defaults', () => {
    const now = 1_700_000_000_000

    expect(
      parseV1FilterCreateInput(
        { phrase: ' taboo ', context: ['home'], expires_in: '3600' },
        now
      )
    ).toEqual({
      phrase: 'taboo',
      context: ['home'],
      irreversible: false,
      wholeWord: false,
      expiresAt: now + 3600 * 1000
    })
  })

  it('coerces string booleans sent by form-encoding clients', () => {
    expect(
      parseV1FilterCreateInput({
        phrase: 'taboo',
        context: ['home'],
        irreversible: 'true',
        whole_word: '1'
      })
    ).toMatchObject({ irreversible: true, wholeWord: true })
  })

  it('accepts a single non-array context value', () => {
    expect(
      parseV1FilterCreateInput({ phrase: 'taboo', context: 'home' })
    ).toMatchObject({ context: ['home'] })
  })

  it.each([
    { description: 'rejects a missing phrase', body: { context: ['home'] } },
    {
      description: 'rejects a blank phrase',
      body: { phrase: '   ', context: ['home'] }
    },
    { description: 'rejects a missing context', body: { phrase: 'taboo' } },
    {
      description: 'rejects an empty context array',
      body: { phrase: 'taboo', context: [] }
    },
    {
      description: 'rejects an unparseable expires_in',
      body: { phrase: 'taboo', context: ['home'], expires_in: 'soon' }
    },
    {
      // An expires_in this large resolves past the max JavaScript Date value,
      // which would otherwise persist a bad row and throw a RangeError when the
      // expiry is formatted for the response.
      description: 'rejects an out-of-range expires_in',
      body: { phrase: 'taboo', context: ['home'], expires_in: '99999999999999' }
    }
  ])('$description', ({ body }) => {
    expect(parseV1FilterCreateInput(body)).toBeNull()
  })
})

describe('parseV1FilterUpdateInput', () => {
  it('keeps omitted irreversible, whole_word and expires_in undefined so stored values survive', () => {
    expect(
      parseV1FilterUpdateInput({ phrase: 'taboo', context: ['home'] })
    ).toEqual({
      phrase: 'taboo',
      context: ['home'],
      irreversible: undefined,
      wholeWord: undefined,
      expiresAt: undefined
    })
  })

  it('maps an empty expires_in to null so the expiry is cleared', () => {
    expect(
      parseV1FilterUpdateInput({
        phrase: 'taboo',
        context: ['home'],
        expires_in: ''
      })
    ).toMatchObject({ expiresAt: null })
  })

  it.each([
    { description: 'still requires phrase', body: { context: ['home'] } },
    { description: 'still requires context', body: { phrase: 'taboo' } },
    {
      description: 'rejects an out-of-range expires_in',
      body: { phrase: 'taboo', context: ['home'], expires_in: '99999999999999' }
    }
  ])('$description', ({ body }) => {
    expect(parseV1FilterUpdateInput(body)).toBeNull()
  })
})

describe('parseV1FilterCreateInput / parseV1FilterUpdateInput (coercion)', () => {
  it('rejects a phrase over 100 characters', () => {
    expect(
      parseV1FilterCreateInput({ phrase: 'x'.repeat(101), context: ['home'] })
    ).toBeNull()
  })

  it('treats a null or non-object body as missing required fields', () => {
    expect(parseV1FilterCreateInput(null)).toBeNull()
    expect(parseV1FilterUpdateInput('phrase=x')).toBeNull()
  })

  it('maps expires_in null to no expiry on create', () => {
    expect(
      parseV1FilterCreateInput({
        phrase: 'p',
        context: ['home'],
        expires_in: null
      })
    ).toMatchObject({ expiresAt: null })
  })

  it('coerces explicit false-like irreversible and whole_word on update', () => {
    expect(
      parseV1FilterUpdateInput({
        phrase: 'p',
        context: ['home'],
        irreversible: 'false',
        whole_word: 0
      })
    ).toMatchObject({ irreversible: false, wholeWord: false })
  })
})
