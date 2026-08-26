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
      description: 'a foreign host carrying a path that is not the media route',
      url: 'https://other.example/some/path.jpg',
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
    },
    // A stored path names one file under the media root, so a `..` segment is
    // never one of ours. `new URL()` resolves dot segments for us only when
    // the separators are literal slashes, which leaves two ways in: an encoded
    // slash on an absolute URL, and the host-relative branch, which never
    // parses a URL at all.
    {
      description:
        'an encoded slash spelling a traversal out of the media root',
      url: 'https://llun.test/api/v1/files/..%2f..%2fsecrets/env',
      expected: null
    },
    {
      description: 'an upper-case encoded traversal',
      url: 'https://llun.test/api/v1/files/%2E%2E%2F%2E%2E%2Fsecrets/env',
      expected: null
    },
    {
      description: 'a traversal reached after a leading directory',
      url: 'https://llun.test/api/v1/files/ab/..%2f..%2f..%2fsecrets/env',
      expected: null
    },
    {
      description: 'a plain traversal on a host-relative URL',
      url: '/api/v1/files/../../secrets/env',
      expected: null
    },
    {
      description: 'a backslash traversal, which Windows resolves the same way',
      url: 'https://llun.test/api/v1/files/..%5c..%5csecrets',
      expected: null
    },
    // A malformed escape leaves the path undecoded, and the check reads that
    // fallback rather than the decoded string it never produced. Nothing
    // traverses either way: an undecodable `%2f` is a literal character to
    // `path.join` too, so the whole value stays one path segment.
    {
      description: 'an encoded traversal left undecoded by a malformed escape',
      url: 'https://llun.test/api/v1/files/..%2f..%2fsecrets%',
      expected: '..%2f..%2fsecrets%'
    },
    // Only a whole `..` segment traverses. A file name that merely contains
    // two dots is an ordinary stored path, and a `.` segment resolves back to
    // the directory it sits in.
    {
      description: 'a stored file name containing two dots',
      url: 'https://llun.test/api/v1/files/ab/..cd..webp',
      expected: 'ab/..cd..webp'
    },
    {
      description: 'a single-dot segment on a host-relative URL',
      url: '/api/v1/files/ab/./cd.webp',
      expected: 'ab/./cd.webp'
    },
    {
      description: 'a file name that is a colon but not a drive',
      url: '/api/v1/files/ab/cd:ef.webp',
      expected: 'ab/cd:ef.webp'
    },
    // An absolute decoded path is not a storage path either. `path.join`
    // reinterprets one as relative and `path.resolve` treats it as an escape,
    // so neither reading is what the URL named.
    {
      description: 'a decoded path that is absolute',
      url: 'https://llun.test/api/v1/files//etc/passwd',
      expected: null
    },
    {
      description: 'a decoded path made absolute by an encoded slash',
      url: 'https://llun.test/api/v1/files/%2Fetc/passwd',
      expected: null
    },
    {
      description: 'a decoded path made absolute by a backslash',
      url: 'https://llun.test/api/v1/files/%5Cetc%5Cpasswd',
      expected: null
    },
    // Windows: a drive letter is absolute, and Win32 strips a component's
    // trailing dots and spaces before opening it, so `.. ` names the parent
    // there. The archive and maintenance scripts run wherever the operator
    // runs them.
    {
      description: 'a Windows drive-letter path',
      url: 'https://llun.test/api/v1/files/C:%5CWindows%5Cwin.ini',
      expected: null
    },
    {
      description: 'a drive-letter path on the host-relative branch',
      url: '/api/v1/files/C:/Windows/win.ini',
      expected: null
    },
    {
      description: 'a traversal whose segments carry a trailing space',
      url: 'https://llun.test/api/v1/files/..%20%2f..%20%2fsecret',
      expected: null
    },
    {
      description: 'a traversal spelled with three dots',
      url: 'https://llun.test/api/v1/files/...%2f...%2fsecret',
      expected: null
    },
    // Node refuses a NUL byte in a path, so letting one through only decides
    // where it throws: on the storage-plan route that aborts the whole export.
    {
      description: 'a path carrying a NUL byte',
      url: 'https://llun.test/api/v1/files/ab%00.webp',
      expected: null
    },
    // A wildcard trusted-host rule is not a literal authority. `new URL()`
    // accepts `*` in a host, so comparing the rule against itself let a URL
    // spelling it pass as ours.
    {
      description: 'a URL whose authority is spelled as the wildcard rule',
      url: 'https://*.cdn.llun.test/api/v1/files/ab/cd.webp',
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
