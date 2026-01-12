import {
  extractActivityPubId,
  normalizeActivityPubAnnounce,
  normalizeActivityPubContent,
  normalizeActivityPubRecipients
} from './activitypub'

describe('#extractActivityPubId', () => {
  it('returns string value directly', () => {
    expect(extractActivityPubId('https://example.com/actor/1')).toEqual(
      'https://example.com/actor/1'
    )
  })

  it('returns id from object', () => {
    expect(
      extractActivityPubId({ id: 'https://example.com/actor/1', name: 'test' })
    ).toEqual('https://example.com/actor/1')
  })

  it('returns href from object if no id', () => {
    expect(
      extractActivityPubId({ href: 'https://example.com/actor/1' })
    ).toEqual('https://example.com/actor/1')
  })

  it('returns url from object if no id or href', () => {
    expect(
      extractActivityPubId({ url: 'https://example.com/actor/1' })
    ).toEqual('https://example.com/actor/1')
  })

  it('extracts id from first valid array item', () => {
    expect(
      extractActivityPubId([
        null,
        'https://example.com/actor/1',
        'https://example.com/actor/2'
      ])
    ).toEqual('https://example.com/actor/1')
  })

  it('extracts id from object within array', () => {
    expect(
      extractActivityPubId([
        { id: 'https://example.com/actor/1' },
        { id: 'https://example.com/actor/2' }
      ])
    ).toEqual('https://example.com/actor/1')
  })

  it('returns undefined for null', () => {
    expect(extractActivityPubId(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(extractActivityPubId(undefined)).toBeUndefined()
  })

  it('returns undefined for number', () => {
    expect(extractActivityPubId(123)).toBeUndefined()
  })

  it('returns undefined for empty object', () => {
    expect(extractActivityPubId({})).toBeUndefined()
  })

  it('returns undefined for empty array', () => {
    expect(extractActivityPubId([])).toBeUndefined()
  })
})

describe('#normalizeActivityPubRecipients', () => {
  it('returns string for single string value', () => {
    expect(
      normalizeActivityPubRecipients('https://example.com/user/1')
    ).toEqual('https://example.com/user/1')
  })

  it('returns array of ids for array input', () => {
    expect(
      normalizeActivityPubRecipients([
        'https://example.com/user/1',
        'https://example.com/user/2'
      ])
    ).toEqual(['https://example.com/user/1', 'https://example.com/user/2'])
  })

  it('extracts ids from objects in array', () => {
    expect(
      normalizeActivityPubRecipients([
        { id: 'https://example.com/user/1' },
        { href: 'https://example.com/user/2' }
      ])
    ).toEqual(['https://example.com/user/1', 'https://example.com/user/2'])
  })

  it('filters out invalid entries', () => {
    expect(
      normalizeActivityPubRecipients([
        'https://example.com/user/1',
        null,
        {},
        'https://example.com/user/2'
      ])
    ).toEqual(['https://example.com/user/1', 'https://example.com/user/2'])
  })

  it('returns undefined for empty array after filtering', () => {
    expect(
      normalizeActivityPubRecipients([null, {}, undefined])
    ).toBeUndefined()
  })

  it('returns undefined for null', () => {
    expect(normalizeActivityPubRecipients(null)).toBeUndefined()
  })
})

describe('#normalizeActivityPubAnnounce', () => {
  it('normalizes actor and object to ids', () => {
    const result = normalizeActivityPubAnnounce({
      type: 'Announce',
      actor: { id: 'https://example.com/actor/1' },
      object: { id: 'https://example.com/note/1' }
    })
    expect(result).toEqual({
      type: 'Announce',
      actor: 'https://example.com/actor/1',
      object: 'https://example.com/note/1'
    })
  })

  it('normalizes to and cc recipients', () => {
    const result = normalizeActivityPubAnnounce({
      type: 'Announce',
      actor: 'https://example.com/actor/1',
      object: 'https://example.com/note/1',
      to: [{ id: 'https://example.com/user/1' }],
      cc: ['https://example.com/user/2']
    })
    expect(result).toEqual({
      type: 'Announce',
      actor: 'https://example.com/actor/1',
      object: 'https://example.com/note/1',
      to: ['https://example.com/user/1'],
      cc: ['https://example.com/user/2']
    })
  })

  it('returns non-record value as-is', () => {
    expect(normalizeActivityPubAnnounce('string')).toEqual('string')
    expect(normalizeActivityPubAnnounce(null)).toEqual(null)
    expect(normalizeActivityPubAnnounce([1, 2, 3])).toEqual([1, 2, 3])
  })
})

describe('#normalizeActivityPubContent', () => {
  it('normalizes attributedTo to id', () => {
    const result = normalizeActivityPubContent({
      type: 'Note',
      attributedTo: { id: 'https://example.com/actor/1' }
    })
    expect(result).toEqual({
      type: 'Note',
      attributedTo: 'https://example.com/actor/1'
    })
  })

  it('normalizes inReplyTo to id', () => {
    const result = normalizeActivityPubContent({
      type: 'Note',
      inReplyTo: { id: 'https://example.com/note/1' }
    })
    expect(result).toEqual({
      type: 'Note',
      inReplyTo: 'https://example.com/note/1'
    })
  })

  it('normalizes url to string', () => {
    const result = normalizeActivityPubContent({
      type: 'Note',
      url: { href: 'https://example.com/note/1' }
    })
    expect(result).toEqual({
      type: 'Note',
      url: 'https://example.com/note/1'
    })
  })

  it('normalizes to and cc recipients', () => {
    const result = normalizeActivityPubContent({
      type: 'Note',
      to: [{ id: 'https://example.com/user/1' }],
      cc: ['https://example.com/user/2']
    })
    expect(result).toEqual({
      type: 'Note',
      to: ['https://example.com/user/1'],
      cc: ['https://example.com/user/2']
    })
  })

  it('returns non-record value as-is', () => {
    expect(normalizeActivityPubContent('string')).toEqual('string')
    expect(normalizeActivityPubContent(null)).toEqual(null)
  })
})
