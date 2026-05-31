import { idToUrl, urlToId } from '@/lib/utils/urlToId'

describe('#urlToId', () => {
  it('converts all / to :', () => {
    expect(urlToId('https://llun.test/users/test1')).toEqual(
      'llun.test:users:test1'
    )
    expect(urlToId('https://llun.test/users/test1/statuses/status-id')).toEqual(
      'llun.test:users:test1:statuses:status-id'
    )
  })

  it('handles empty strings', () => {
    expect(urlToId('')).toEqual('')
  })

  it('handles URLs with query parameters', () => {
    expect(urlToId('https://llun.test/users/test1?param=value')).toEqual(
      'llun.test:users:test1?param=value'
    )
  })

  it('handles URLs with fragments', () => {
    expect(urlToId('https://llun.test/users/test1#section')).toEqual(
      'llun.test:users:test1#section'
    )
  })

  it('handles URLs with special characters', () => {
    expect(urlToId('https://llun.test/users/test-user+name')).toEqual(
      'llun.test:users:test-user+name'
    )
    expect(urlToId('https://llun.test/users/test%20user')).toEqual(
      'llun.test:users:test%20user'
    )
  })

  it('handles URLs without protocol', () => {
    expect(urlToId('llun.test/users/test1')).toEqual('llun.test:users:test1')
  })

  it('round trips opaque ActivityPub IDs with colons in path segments', () => {
    const actorId = 'https://bsky.brid.gy/ap/did:plc:abc123/statuses/post-1'

    expect(idToUrl(urlToId(actorId))).toEqual(actorId)
  })

  it('round trips URLs with ports', () => {
    const statusId = 'http://localhost:3001/users/test1/statuses/post-1'

    expect(idToUrl(urlToId(statusId))).toEqual(statusId)
  })

  it('round trips port-bearing IDs when Buffer lacks base64url support', () => {
    // Reproduces the browser bundle (Turbopack injects the `buffer` polyfill,
    // which supports `base64` but NOT `base64url`). Without the fix, urlToId's
    // bare catch swallows the throw and returns the raw URL with slashes.
    const actorId = 'https://localhost:3100/users/testuser'
    const RealBuffer = globalThis.Buffer

    const PolyfillBuffer = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from(value: string, encoding?: any) {
        if (encoding === 'base64url') {
          throw new TypeError('Unknown encoding: base64url')
        }
        const buffer = RealBuffer.from(value, encoding)
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toString(outEncoding?: any) {
            if (outEncoding === 'base64url') {
              throw new TypeError('Unknown encoding: base64url')
            }
            return buffer.toString(outEncoding)
          }
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).Buffer = PolyfillBuffer

    try {
      const encoded = urlToId(actorId)
      expect(encoded.startsWith('apurl_')).toBe(true)
      expect(encoded).not.toContain('/')
      expect(idToUrl(encoded)).toEqual(actorId)
    } finally {
      globalThis.Buffer = RealBuffer
    }
  })

  it('uses Buffer (not the btoa/atob fallbacks) when Buffer is available', () => {
    const originalBtoa = globalThis.btoa
    const originalAtob = globalThis.atob
    const actorId = 'https://bsky.brid.gy/ap/did:plc:abc123/statuses/post-1'

    globalThis.btoa = jest.fn(() => {
      throw new Error('btoa should not be used when Buffer is available')
    })
    globalThis.atob = jest.fn(() => {
      throw new Error('atob should not be used when Buffer is available')
    })

    try {
      expect(idToUrl(urlToId(actorId))).toEqual(actorId)
    } finally {
      globalThis.btoa = originalBtoa
      globalThis.atob = originalAtob
    }
  })
})

describe('#idToUrl', () => {
  it('converts all : to /', () => {
    expect(idToUrl('llun.test:users:test1')).toEqual(
      'https://llun.test/users/test1'
    )
  })

  it('handles empty strings', () => {
    expect(idToUrl('')).toEqual('')
  })

  it('handles IDs with query parameters', () => {
    expect(idToUrl('llun.test:users:test1?param=value')).toEqual(
      'https://llun.test/users/test1?param=value'
    )
  })

  it('handles IDs with fragments', () => {
    expect(idToUrl('llun.test:users:test1#section')).toEqual(
      'https://llun.test/users/test1#section'
    )
  })

  it('handles IDs with special characters', () => {
    expect(idToUrl('llun.test:users:test-user+name')).toEqual(
      'https://llun.test/users/test-user+name'
    )
    expect(idToUrl('llun.test:users:test%20user')).toEqual(
      'https://llun.test/users/test%20user'
    )
  })

  it('preserves https protocol if already in the ID', () => {
    expect(idToUrl('https:llun.test:users:test1')).toEqual(
      'https://llun.test/users/test1'
    )
  })

  it('handles IDs with multiple consecutive colons', () => {
    expect(idToUrl('llun.test:users::test1')).toEqual(
      'https://llun.test/users//test1'
    )
  })

  it('returns an empty string for invalid opaque ActivityPub IDs', () => {
    expect(idToUrl('apurl_not-a-url')).toEqual('')
  })
})
