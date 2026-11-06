import {
  decodeFavouriteCursor,
  encodeFavouriteCursor
} from '@/lib/database/domains/like/favouriteCursor'

describe('favouriteCursor', () => {
  it('preserves status ids that contain colons', () => {
    const cursor = {
      createdAt: 42,
      statusId: 'https://example.social:8443/notes/abc'
    }
    expect(decodeFavouriteCursor(encodeFavouriteCursor(cursor))).toEqual(cursor)
  })

  // '@' and '%' are outside the base64url alphabet, so these decode to an empty
  // buffer and must be rejected rather than scanning from the top of the list.
  it.each([null, undefined, '', '@@@', '%%%%'])(
    'returns null for malformed cursor %p',
    (value) => {
      expect(decodeFavouriteCursor(value)).toBeNull()
    }
  )

  it('returns null when the createdAt segment is not a number', () => {
    const encoded = Buffer.from('abc:status', 'utf8').toString('base64url')
    expect(decodeFavouriteCursor(encoded)).toBeNull()
  })

  it('returns null when the status id segment is empty', () => {
    const encoded = Buffer.from('123:', 'utf8').toString('base64url')
    expect(decodeFavouriteCursor(encoded)).toBeNull()
  })

  it('returns null for a createdAt past the range a Date can hold', () => {
    const encoded = (text: string) =>
      Buffer.from(text, 'utf8').toString('base64url')
    expect(decodeFavouriteCursor(encoded('8640000000000000:status'))).toEqual({
      createdAt: 8.64e15,
      statusId: 'status'
    })
    expect(decodeFavouriteCursor(encoded('9000000000000000:status'))).toBeNull()
  })
})
