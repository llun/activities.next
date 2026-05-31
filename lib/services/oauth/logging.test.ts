import { sanitizeFormBody, sanitizeHeaders, sanitizeParams } from './logging'

jest.mock('@/lib/utils/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => logger)
  }
  return { logger }
})

describe('oauth logging sanitizers', () => {
  describe('sanitizeHeaders', () => {
    it('keeps the auth scheme but redacts the credential', () => {
      const headers = new Headers({
        authorization: 'Basic dXNlcjpwYXNz',
        'content-type': 'application/x-www-form-urlencoded'
      })
      expect(sanitizeHeaders(headers)).toEqual({
        authorization: 'Basic [REDACTED]',
        'content-type': 'application/x-www-form-urlencoded'
      })
    })

    it('fully redacts cookies and schemeless credentials', () => {
      const headers = new Headers({
        cookie: 'session=secret',
        authorization: 'opaque-token-without-scheme'
      })
      expect(sanitizeHeaders(headers)).toEqual({
        cookie: '[REDACTED]',
        authorization: '[REDACTED]'
      })
    })
  })

  describe('sanitizeFormBody', () => {
    it('redacts secret params including the PKCE code_verifier', () => {
      const body =
        'grant_type=authorization_code&client_id=abc&code=auth-code&code_verifier=pkce-secret&client_secret=shh'
      expect(sanitizeFormBody(body)).toEqual({
        grant_type: 'authorization_code',
        client_id: 'abc',
        code: '[REDACTED]',
        code_verifier: '[REDACTED]',
        client_secret: '[REDACTED]'
      })
    })

    it('redacts secret keys that carry surrounding whitespace', () => {
      const body = '+code_verifier+=pkce-secret&client_id=abc'
      expect(sanitizeFormBody(body)).toEqual({
        ' code_verifier ': '[REDACTED]',
        client_id: 'abc'
      })
    })
  })

  describe('sanitizeParams', () => {
    it('redacts secret keys regardless of case and whitespace', () => {
      expect(
        sanitizeParams({
          client_id: 'abc',
          ' Client_Secret ': 'shh',
          redirect_uris: ['https://example.test/cb']
        })
      ).toEqual({
        client_id: 'abc',
        ' Client_Secret ': '[REDACTED]',
        redirect_uris: ['https://example.test/cb']
      })
    })
  })
})
