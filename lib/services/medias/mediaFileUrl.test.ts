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
      description: 'a foreign host carrying our media route in a query string',
      url: 'https://other.example/redirect?to=/api/v1/files/ab/cd.webp',
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
      description: 'a media URL on our own host carrying a query string',
      url: 'https://llun.test/api/v1/files/ab/cd.webp?v=2',
      expected: 'ab/cd.webp'
    },
    {
      description: 'our own host on a different port',
      url: 'https://llun.test:8443/api/v1/files/ab/cd.webp',
      expected: null
    },
    // `getCanonicalAuthority` strips BOTH default ports, so the exact pass
    // accepts a spelling `hostMatchesRule` (which treats only `:443` as
    // implied) would not. It is the same hostname either way; pinned because
    // the deleted script copy went through the rules matcher alone and
    // answered null here.
    {
      description: 'port 80 spelled out on our own host',
      url: 'https://llun.test:80/api/v1/files/ab/cd.webp',
      expected: 'ab/cd.webp'
    },
    {
      description: 'port 443 spelled out on our own host',
      url: 'https://llun.test:443/api/v1/files/ab/cd.webp',
      expected: 'ab/cd.webp'
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

  // The row above is the obvious spelling. These are the ones a
  // leading-characters test misses: the WHATWG parser grows an authority out of
  // input that does not begin with `//`, because it reads `\` as `/` for a
  // special scheme and strips tab, LF and CR before parsing at all. Each is
  // therefore protocol-relative and names somebody else's instance, and each
  // must stay refused if this branch is ever rewritten to parse rather than to
  // read the raw string.
  it.each([
    { description: 'a backslash authority', prefix: '/\\' },
    { description: 'a doubled backslash authority', prefix: '/\\\\' },
    { description: 'a tab-smuggled authority', prefix: '/\t/' },
    { description: 'a newline-smuggled authority', prefix: '/\n/' },
    { description: 'a carriage-return-smuggled authority', prefix: '/\r/' },
    { description: 'a tab-plus-backslash authority', prefix: '/\t\\' }
  ])('refuses $description', ({ prefix }) => {
    expect(
      getMediaPathFromFileUrl(
        `${prefix}other.example/api/v1/files/ab/cd.webp`,
        config
      )
    ).toBeNull()
  })

  // The URL parser folds a literal `../` out of the pathname before this ever
  // sees it, so a path that walks up and back down inside the media root stays
  // a legal stored path. The refusals for the spellings it does NOT fold are
  // in the table above.
  it('resolves a literal dot segment that stays inside the media root', () => {
    expect(
      getMediaPathFromFileUrl(
        'https://llun.test/api/v1/files/ab/../cd.webp',
        config
      )
    ).toBe('cd.webp')
  })

  // NOT A TRAVERSAL GUARANTEE — these two pin what this helper RETURNS for a
  // path it cannot canonicalise, and both answers are traversal-shaped.
  // Neither of these is canonical, and both are answered as a path on purpose —
  // pinned because §"decoding" above argues they are safe only because no
  // consumer decodes again. A consumer that does would need its own check, and
  // these are what would change if this helper ever started canonicalising.
  it.each([
    {
      description:
        'leaves a double-encoded traversal encoded rather than resolving it',
      url: 'https://llun.test/api/v1/files/%252e%252e%252fetc%252fpasswd',
      expected: '%2e%2e%2fetc%2fpasswd'
    },
    {
      description: 'hands back the raw path when an escape cannot be decoded',
      url: 'https://llun.test/api/v1/files/x%zz/y.jpg',
      expected: 'x%zz/y.jpg'
    },
    // `decodeURIComponent` throws on the first bad escape ANYWHERE in its
    // input, so one undecodable segment shelters the encoded separators beside
    // it and this reads as a single harmless segment. Inert at both consumers —
    // `path.join` and an S3 key both treat `%2f` as an ordinary character, so
    // it names a strange file rather than walking anywhere — but pinned,
    // because it is what would change if this helper ever decoded per segment.
    {
      description: 'reads an undecodable encoded traversal as one segment',
      url: 'https://llun.test/api/v1/files/..%2f..%2fetc%2fpasswd%zz',
      expected: '..%2f..%2fetc%2fpasswd%zz'
    }
  ])('$description', ({ url, expected }) => {
    expect(getMediaPathFromFileUrl(url, config)).toBe(expected)
  })

  // Moved here from `backfillMediaBlurhash.test.ts`, whose `isOwnAuthority`
  // carried these three and is deleted by this PR. Only `*.example.com` is a
  // wildcard; every other spelling reaches the matcher as a LITERAL rule
  // carrying a `*`, and `new URL()` percent-decodes `%2a`, so a federated
  // attachment URL could spell one exactly and have the named path read out of
  // local storage. Refused now by `normalizeHost`, one layer further in.
  it.each([
    { description: 'a wildcard missing its dot', rule: '*cdn.llun.test' },
    { description: 'a trailing wildcard label', rule: 'cdn.*' },
    { description: 'a wildcard in the middle', rule: 'foo.*.cdn.llun.test' }
  ])('refuses an authority spelled as $description', ({ rule }) => {
    const url = `https://${rule.replaceAll('*', '%2a')}/api/v1/files/media/a.webp`
    expect(
      getMediaPathFromFileUrl(url, { host: 'llun.test', trustedHosts: [rule] })
    ).toBeNull()
  })

  it('still refuses a foreign host when a wildcard rule is configured', () => {
    expect(
      getMediaPathFromFileUrl(
        'https://evil.example/api/v1/files/ab/cd.webp',
        config
      )
    ).toBeNull()
  })

  // `getTrustedHostRules` always contributes `config.host`, so an unconfigured
  // instance carries an empty rule that must never match an authority.
  it('refuses every URL when no host is configured', () => {
    expect(
      getMediaPathFromFileUrl('https://llun.test/api/v1/files/ab/cd.webp', {
        host: '',
        trustedHosts: ['']
      })
    ).toBeNull()
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
