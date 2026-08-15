import {
  AUTH_ERROR_FALLBACK,
  resolveAuthErrorContent,
  sanitizeAuthErrorCode
} from './errorPage'

describe('sanitizeAuthErrorCode', () => {
  it.each([
    { description: 'keeps a plain oauth-provider code', raw: 'invalid_client' },
    { description: 'keeps a hyphenated code', raw: 'client-disabled' },
    { description: 'keeps an upper-case core code', raw: 'INVALID_TOKEN' }
  ])('$description', ({ raw }) => {
    expect(sanitizeAuthErrorCode(raw)).toEqual(raw)
  })

  it('takes the first value when the parameter is repeated', () => {
    expect(
      sanitizeAuthErrorCode(['invalid_client', 'client_disabled'])
    ).toEqual('invalid_client')
  })

  it.each([
    { description: 'rejects a missing parameter', raw: undefined },
    { description: 'rejects an empty value', raw: '' },
    { description: 'rejects an empty repeated value', raw: [] },
    {
      description: 'rejects prose with spaces',
      raw: 'your account is suspended'
    },
    { description: 'rejects markup', raw: '<img src=x onerror=alert(1)>' },
    { description: 'rejects a value carrying its own query', raw: 'a&b=c' },
    { description: 'rejects a code over the length cap', raw: 'a'.repeat(65) }
  ])('$description', ({ raw }) => {
    expect(sanitizeAuthErrorCode(raw)).toBeNull()
  })
})

describe('resolveAuthErrorContent', () => {
  it.each([
    { code: 'invalid_client', title: "This app isn't registered here" },
    { code: 'client_disabled', title: 'This app has been disabled' },
    { code: 'unauthorized_client', title: "This app can't sign you in" },
    {
      code: 'invalid_redirect',
      title: "This app's return address isn't registered"
    },
    { code: 'access_denied', title: 'Sign-in cancelled' },
    { code: 'INVALID_TOKEN', title: 'This link is no longer valid' }
  ])("describes $code in the visitor's terms", ({ code, title }) => {
    expect(resolveAuthErrorContent(code).title).toEqual(title)
  })

  it.each([
    { description: 'falls back for an unmapped code', code: 'made_up_code' },
    { description: 'falls back when there is no code', code: null }
  ])('$description', ({ code }) => {
    expect(resolveAuthErrorContent(code)).toEqual(AUTH_ERROR_FALLBACK)
  })

  it('never resolves content from a prototype key', () => {
    expect(resolveAuthErrorContent('constructor')).toEqual(AUTH_ERROR_FALLBACK)
    expect(resolveAuthErrorContent('toString')).toEqual(AUTH_ERROR_FALLBACK)
  })
})
