import { describe, expect, it } from 'vitest'

import {
  MAX_CONTENT_DIGEST_LENGTH,
  createContentDigestHeader,
  verifyContentDigest
} from './contentDigest'

const BODY = Buffer.from('{"hello": "world"}')
const SHA256 = 'sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:'
const SHA512 =
  'sha-512=:WZDPaVn/7XgHaAy8pmojAkGWoRx2UFChF41A2svX+TaPm+AbwAgBWnrIiYllu7BNNyealdVLvRwEmTHWXvJwew==:'

describe('verifyContentDigest', () => {
  it('rejects a header over the length cap as malformed', () => {
    // The extra member is a valid byte sequence of an unknown algorithm, so the
    // header would parse and match without the length cap.
    const header = `${SHA256}, x=:${'A'.repeat(1100)}:`
    expect(header.length).toBeGreaterThan(MAX_CONTENT_DIGEST_LENGTH)
    expect(verifyContentDigest(header, BODY)).toBe('malformed')
    expect(verifyContentDigest(SHA256, BODY)).toBe('match')
  })

  it('matches sha-256', () => {
    expect(verifyContentDigest(SHA256, BODY)).toBe('match')
  })

  it('matches sha-512', () => {
    expect(verifyContentDigest(SHA512, BODY)).toBe('match')
  })

  it('matches both when both are present', () => {
    expect(verifyContentDigest(`${SHA256}, ${SHA512}`, BODY)).toBe('match')
  })

  it('mismatches when any supported digest is wrong', () => {
    expect(verifyContentDigest(`${SHA256}, sha-512=:AAAA:`, BODY)).toBe(
      'mismatch'
    )
  })

  it('mismatches when the body differs', () => {
    expect(verifyContentDigest(SHA256, Buffer.from('{"hello": "World"}'))).toBe(
      'mismatch'
    )
  })

  it('reports unsupported when only unknown algorithms are present', () => {
    expect(verifyContentDigest('md5=:AAAAAAAAAAAAAAAAAAAAAA==:', BODY)).toBe(
      'unsupported'
    )
  })

  it('ignores unknown algorithms next to a good supported one', () => {
    expect(
      verifyContentDigest(`md5=:AAAAAAAAAAAAAAAAAAAAAA==:, ${SHA256}`, BODY)
    ).toBe('match')
  })

  it.each(['sha-256=X48E9q', 'sha-256=:@@:', '', 'sha-256=1', 'sha-256'])(
    'reports malformed for %j',
    (header) => {
      expect(verifyContentDigest(header, BODY)).toBe('malformed')
    }
  )
})

describe('createContentDigestHeader', () => {
  it('produces the sha-256 vector', () => {
    expect(createContentDigestHeader(BODY)).toBe(SHA256)
  })

  it('round-trips through verifyContentDigest', () => {
    const body = Buffer.from('anything at all')
    expect(verifyContentDigest(createContentDigestHeader(body), body)).toBe(
      'match'
    )
  })
})
