import { describe, expect, it } from 'vitest'

import {
  SfInnerList,
  parseSfDictionary,
  serializeSfInnerList
} from './structuredFields'

const innerList = (input: string, key: string): SfInnerList => {
  const member = parseSfDictionary(input)?.get(key)
  if (!member || member.kind !== 'innerList') throw new Error('not inner list')
  return member
}

describe('parseSfDictionary', () => {
  it('parses a Signature-Input value', () => {
    const input =
      'sig1=("@method" "@target-uri" "content-digest");created=1618884473;keyid="https://remote.test/users/alice#main-key";alg="rsa-v1_5-sha256"'
    const list = innerList(input, 'sig1')
    expect(list.items.map((i) => i.item)).toEqual([
      { type: 'string', value: '@method' },
      { type: 'string', value: '@target-uri' },
      { type: 'string', value: 'content-digest' }
    ])
    expect(list.params).toEqual([
      ['created', { type: 'integer', value: 1618884473 }],
      [
        'keyid',
        { type: 'string', value: 'https://remote.test/users/alice#main-key' }
      ],
      ['alg', { type: 'string', value: 'rsa-v1_5-sha256' }]
    ])
  })

  it('round-trips an inner list', () => {
    const input =
      'sig1=("@method" "@target-uri" "content-digest");created=1618884473;keyid="k";alg="rsa-v1_5-sha256"'
    const list = innerList(input, 'sig1')
    expect(serializeSfInnerList(list)).toBe(input.slice('sig1='.length))
  })

  it('canonicalizes whitespace', () => {
    const list = innerList('sig1=(  "@method"   "@path" );created=1', 'sig1')
    expect(serializeSfInnerList(list)).toBe('("@method" "@path");created=1')
  })

  it('parses byte sequences', () => {
    const member = parseSfDictionary('sig1=:dGVzdA==:')?.get('sig1')
    expect(member?.kind).toBe('item')
    if (member?.kind === 'item' && member.item.type === 'bytes') {
      expect(member.item.value.toString()).toBe('test')
    } else {
      throw new Error('expected bytes')
    }
  })

  it('parses two-member dictionaries with OWS around the comma', () => {
    const dict = parseSfDictionary('sha-256=:AAAA:\t, sha-512=:BBBB:')
    expect([...(dict?.keys() ?? [])]).toEqual(['sha-256', 'sha-512'])
  })

  it('parses parameters on inner list items and bare keys', () => {
    const dict = parseSfDictionary('a=("x";req);flag')
    const list = dict?.get('a')
    expect(list?.kind).toBe('innerList')
    if (list?.kind === 'innerList') {
      expect(list.items[0].params).toEqual([
        ['req', { type: 'boolean', value: true }]
      ])
    }
    if (list?.kind === 'innerList') {
      expect(list.params).toEqual([['flag', { type: 'boolean', value: true }]])
    }
    expect(dict?.size).toBe(1)
    expect(serializeSfInnerList(innerList('a=("x";req);flag', 'a'))).toBe(
      '("x";req);flag'
    )
    expect(parseSfDictionary('bare, k=1')?.get('bare')).toEqual({
      kind: 'item',
      item: { type: 'boolean', value: true },
      params: []
    })
  })

  it('unescapes strings and re-escapes on serialize', () => {
    const dict = parseSfDictionary('a="q\\"b\\\\c"')
    expect(dict?.get('a')).toMatchObject({
      item: { type: 'string', value: 'q"b\\c' }
    })
    const list = innerList('a=("q\\"b\\\\c")', 'a')
    expect(serializeSfInnerList(list)).toBe('("q\\"b\\\\c")')
  })

  it('parses tokens, decimals, booleans and negative integers', () => {
    const dict = parseSfDictionary('a=foo/bar:baz, b=-12.5, c=?0, d=-7')
    expect(dict?.get('a')).toMatchObject({
      item: { type: 'token', value: 'foo/bar:baz' }
    })
    expect(dict?.get('b')).toMatchObject({
      item: { type: 'decimal', value: -12.5 }
    })
    expect(dict?.get('c')).toMatchObject({
      item: { type: 'boolean', value: false }
    })
    expect(dict?.get('d')).toMatchObject({
      item: { type: 'integer', value: -7 }
    })
  })

  it('accepts an empty dictionary', () => {
    expect(parseSfDictionary('')?.size).toBe(0)
  })

  it.each([
    'sig1=("@method"',
    'sig1=:not base64!:',
    'Sig1=1',
    'a=1,',
    'a="unterminated',
    'a=1234567890123456',
    'a=1 b=2',
    'a="bad\\nescape"',
    'a=1.',
    'a=1.2345',
    'a=?2',
    'a=("x""y")',
    'a=:AAAAA:',
    'a="é"',
    ',a=1'
  ])('rejects malformed input %j without throwing', (input) => {
    expect(parseSfDictionary(input)).toBeNull()
  })
})

describe('structured field limits and padding', () => {
  const bytesOf = (input: string) => {
    const member = parseSfDictionary(input)?.get('a')
    if (!member || member.kind !== 'item' || member.item.type !== 'bytes') {
      return null
    }
    return member.item.value.toString()
  }

  it('accepts byte sequences without padding', () => {
    expect(bytesOf('a=:dGVzdA:')).toBe('test')
    expect(bytesOf('a=:dGVzdA==:')).toBe('test')
  })

  it('rejects impossible or misplaced base64', () => {
    expect(bytesOf('a=:dGVzd:')).toBeNull()
    expect(bytesOf('a=:dG=zdA:')).toBeNull()
  })

  it('rejects malformed padding', () => {
    expect(bytesOf('a=:==:')).toBeNull()
    expect(bytesOf('a=:A==:')).toBeNull()
    expect(bytesOf('a=:AA=:')).toBeNull()
  })

  it('accepts well-formed padding', () => {
    expect(bytesOf('a=:AA==:')).not.toBeNull()
    expect(bytesOf('a=:AAA=:')).not.toBeNull()
  })

  it('accepts exactly 64 parameters and rejects 65', () => {
    const params = (count: number) =>
      Array.from({ length: count }, (_, i) => `;p${i}=1`).join('')
    expect(
      parseSfDictionary(`a=1${params(64)}`)?.get('a')?.params
    ).toHaveLength(64)
    expect(parseSfDictionary(`a=(1)${params(64)}`)).not.toBeNull()
    expect(parseSfDictionary(`a=1${params(65)}`)).toBeNull()
    expect(parseSfDictionary(`a=(1)${params(65)}`)).toBeNull()
  })

  it('returns null for a dictionary with too many parameters', () => {
    const params = Array.from({ length: 5000 }, (_, i) => `;p${i}=1`).join('')
    expect(parseSfDictionary(`a=1${params}`)).toBeNull()
    expect(parseSfDictionary(`a=(1)${params}`)).toBeNull()
  })

  it('keeps last-wins and first-position order for duplicate parameters', () => {
    const member = parseSfDictionary('a=1;x=1;y=2;x=3')?.get('a')
    expect(member?.params).toEqual([
      ['x', { type: 'integer', value: 3 }],
      ['y', { type: 'integer', value: 2 }]
    ])
  })
})
