import { isSafeInternalPath } from './isSafeInternalPath'

describe('isSafeInternalPath', () => {
  it.each([
    { description: 'the root path', value: '/' },
    { description: 'a normal internal path', value: '/fitness' },
    {
      description: 'an internal path whose query contains a URL',
      value: '/oauth/authorize?redirect_uri=https://x/cb&scope=openid'
    },
    {
      description: 'an internal path with a slash inside a query value',
      value: '/path?a=//b'
    },
    {
      description: 'a path that normalizes to a same-origin path',
      value: '/\nfoo'
    }
  ])('accepts $description', ({ value }) => {
    expect(isSafeInternalPath(value)).toBe(true)
  })

  it.each([
    { description: 'a protocol-relative path', value: '//evil.com' },
    { description: 'a triple-slash path', value: '///evil.com' },
    { description: 'a backslash-prefixed path', value: '/\\evil.com' },
    { description: 'a path with a backslash anywhere', value: '/foo\\bar' },
    { description: 'a tab-then-slash path', value: '/\t/evil.com' },
    { description: 'a newline-then-slash path', value: '/\n/evil.com' },
    { description: 'an absolute http URL', value: 'https://evil.com' },
    {
      description: 'a scheme-relative javascript URL',
      value: 'javascript:alert(1)'
    },
    { description: 'a relative path without a leading slash', value: 'foo' },
    { description: 'an empty string', value: '' },
    { description: 'null', value: null },
    { description: 'undefined', value: undefined }
  ])('rejects $description', ({ value }) => {
    expect(isSafeInternalPath(value)).toBe(false)
  })

  it.each([
    { description: 'a percent-encoded double slash', value: '/%2f%2fevil.com' },
    { description: 'a percent-encoded backslash', value: '/%5cevil.com' },
    {
      description: 'a literal percent that is not an escape',
      value: '/100%done'
    }
  ])(
    'accepts $description as a same-origin path (percent-encoding is not decoded during navigation)',
    ({ value }) => {
      // router.push / server redirect keep these encoded in the path, so they
      // resolve same-origin (NOT off-origin). Decoding the pathname to "reject"
      // them would over-reject valid paths like /100%done and throw on malformed
      // escapes, so they are intentionally treated as safe internal paths.
      expect(isSafeInternalPath(value)).toBe(true)
    }
  )
})
