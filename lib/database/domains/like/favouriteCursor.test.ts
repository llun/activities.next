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
})
