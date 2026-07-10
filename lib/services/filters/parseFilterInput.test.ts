import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseV1FilterCreateInput,
  parseV1FilterUpdateInput
} from '@/lib/services/filters/parseFilterInput'

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
