import { getMediaFileUrl, getMediaPathFromFileUrl } from './mediaFileUrl'

describe('getMediaFileUrl', () => {
  it.each([
    {
      description: 'serves a remote host over https',
      host: 'llun.test',
      mediaPath: 'medias/2026-07-26/map.jpg',
      expected: 'https://llun.test/api/v1/files/medias/2026-07-26/map.jpg'
    },
    {
      description: 'serves localhost over http',
      host: 'localhost:3000',
      mediaPath: 'map.jpg',
      expected: 'http://localhost:3000/api/v1/files/map.jpg'
    },
    {
      description: 'serves a loopback address over http',
      host: '127.0.0.1:8080',
      mediaPath: 'map.webp',
      expected: 'http://127.0.0.1:8080/api/v1/files/map.webp'
    },
    {
      description: 'serves a bracketed IPv6 loopback over http',
      host: '[::1]:3000',
      mediaPath: 'map.jpg',
      expected: 'http://[::1]:3000/api/v1/files/map.jpg'
    }
  ])('$description', ({ host, mediaPath, expected }) => {
    expect(getMediaFileUrl(host, mediaPath)).toBe(expected)
  })

  // `isLocalHost` also matches a bare `::1`. Only the scheme is asserted: a
  // bracketless IPv6 authority is not a parseable URL, so pinning the whole
  // string would enshrine a value no client could use.
  it('treats a bare IPv6 loopback as local', () => {
    expect(getMediaFileUrl('::1', 'map.jpg')).toMatch(/^http:/)
  })
})

describe('getMediaPathFromFileUrl', () => {
  const config = {
    host: 'llun.test',
    trustedHosts: ['alias.llun.test', '*.cdn.llun.test']
  }

  it.each([
    {
      description: 'a media URL on the configured host',
      url: 'https://llun.test/api/v1/files/ab/cd.webp',
      expected: 'ab/cd.webp'
    },
    {
      description: 'a media URL on a trusted host',
      url: 'https://alias.llun.test/api/v1/files/ab/cd.webp',
      expected: 'ab/cd.webp'
    },
    {
      description: 'a media URL on a wildcard trusted host',
      url: 'https://media.cdn.llun.test/api/v1/files/ab/cd.webp',
      expected: 'ab/cd.webp'
    },
    {
      description: 'an encoded space in the stored path',
      url: 'https://llun.test/api/v1/files/ab%20cd/ef.webp',
      expected: 'ab cd/ef.webp'
    },
    {
      description: 'a host-relative media URL',
      url: '/api/v1/files/ab/cd.webp',
      expected: 'ab/cd.webp'
    },
    {
      description: 'a host-relative media URL carrying a query string',
      url: '/api/v1/files/ab/cd.webp?v=2',
      expected: 'ab/cd.webp'
    },
    // The bug this pairing exists for: `/api/v1/files/` is this project's own
    // route, so every other activities.next instance serves attachment URLs
    // under exactly that path.
    {
      description: 'another instance serving the same media route',
      url: 'https://other.example/api/v1/files/ab/cd.webp',
      expected: null
    },
    {
      description: 'a protocol-relative URL naming another instance',
      url: '//other.example/api/v1/files/ab/cd.webp',
      expected: null
    },
    {
      description: 'a host that only shares a suffix with a trusted host',
      url: 'https://evil-llun.test/api/v1/files/ab/cd.webp',
      expected: null
    },
    {
      description: 'a subdomain of the configured host',
      url: 'https://sub.llun.test/api/v1/files/ab/cd.webp',
      expected: null
    },
    {
      description: 'our own host on a different port',
      url: 'https://llun.test:8443/api/v1/files/ab/cd.webp',
      expected: null
    },
    {
      description: 'a fitness-file URL on our own host',
      url: 'https://llun.test/api/v1/fitness-files/id-1',
      expected: null
    },
    {
      description: 'our own media route with nothing after it',
      url: 'https://llun.test/api/v1/files/',
      expected: null
    },
    {
      description: 'a value that is not a URL at all',
      url: 'not-a-url',
      expected: null
    }
  ])('$description', ({ url, expected }) => {
    expect(getMediaPathFromFileUrl(url, config)).toBe(expected)
  })

  // `normalizeHost` rejects loopback names, so the trusted-host matcher alone
  // answers "not ours" for a development instance's own media URLs.
  it('resolves a media URL on a loopback development host', () => {
    expect(
      getMediaPathFromFileUrl('http://localhost:3000/api/v1/files/ab/cd.webp', {
        host: 'localhost:3000'
      })
    ).toBe('ab/cd.webp')
  })

  it('round-trips a path through getMediaFileUrl', () => {
    const url = getMediaFileUrl('llun.test', 'medias/2026-07-26/map.jpg')
    expect(getMediaPathFromFileUrl(url, config)).toBe(
      'medias/2026-07-26/map.jpg'
    )
  })
})
