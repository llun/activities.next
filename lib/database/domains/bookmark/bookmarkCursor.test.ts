import {
  decodeBookmarkCursor,
  encodeBookmarkCursor,
  toBookmarkCursor
} from '@/lib/database/domains/bookmark/bookmarkCursor'

describe('bookmarkCursor', () => {
  it('round-trips a keyset', () => {
    const cursor = { createdAt: 1_700_000_000_000, id: 42 }
    expect(decodeBookmarkCursor(encodeBookmarkCursor(cursor))).toEqual(cursor)
  })

  it('encodes a bookmark row as its own keyset', () => {
    expect(
      decodeBookmarkCursor(
        toBookmarkCursor({ createdAt: 1_700_000_000_000, id: '42' })
      )
    ).toEqual({ createdAt: 1_700_000_000_000, id: 42 })
  })

  it('keeps accepting a legacy numeric bookmark id', () => {
    expect(decodeBookmarkCursor('42')).toEqual({ createdAt: null, id: 42 })
  })

  // '@' and '%' are outside the base64url alphabet, so these decode to an empty
  // buffer and must be rejected rather than scanning from the top of the list.
  it.each([null, undefined, '', '@@@', '%%%%', 'not-a-number', '12:34'])(
    'returns null for malformed cursor %p',
    (value) => {
      expect(decodeBookmarkCursor(value)).toBeNull()
    }
  )

  it('returns null for a composite cursor with an unusable id', () => {
    const encoded = (text: string) =>
      Buffer.from(text, 'utf8').toString('base64url')
    expect(decodeBookmarkCursor(encoded('1000:0'))).toBeNull()
    expect(
      decodeBookmarkCursor(encoded('1000:99999999999999999999'))
    ).toBeNull()
    expect(decodeBookmarkCursor(encoded('-1:2'))).toBeNull()
  })

  it('returns null for a createdAt past the range a Date can hold', () => {
    const encoded = (text: string) =>
      Buffer.from(text, 'utf8').toString('base64url')
    expect(decodeBookmarkCursor(encoded('8640000000000000:1'))).toEqual({
      createdAt: 8.64e15,
      id: 1
    })
    expect(decodeBookmarkCursor(encoded('9000000000000000:1'))).toBeNull()
  })

  it('returns null for a numeric id past the safe integer range', () => {
    expect(decodeBookmarkCursor('99999999999999999999')).toBeNull()
  })
})
