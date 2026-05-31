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

    it('redacts a multi-cookie header in full, not just the last pair', () => {
      const headers = new Headers({
        cookie: 'session=secret; theme=dark'
      })
      // The space after `;` must not be mistaken for an auth scheme delimiter.
      expect(sanitizeHeaders(headers)).toEqual({
        cookie: '[REDACTED]'
      })
    })

    it('strips query and fragment from URL-bearing headers', () => {
      const headers = new Headers({
        referer:
          'https://app.example.test/callback?code=auth-secret&state=xyz#access_token=tok'
      })
      // code/access_token/state in the redirect URL must not be logged.
      expect(sanitizeHeaders(headers)).toEqual({
        referer: 'https://app.example.test/callback'
      })
    })

    it('keeps the path of a relative URL-bearing header, dropping query/fragment', () => {
      const headers = new Headers({
        referer: '/oauth/callback?code=auth-secret#access_token=tok'
      })
      expect(sanitizeHeaders(headers)).toEqual({
        referer: '/oauth/callback'
      })
    })

    it('redacts a URL-bearing header that is not a parseable URL', () => {
      const headers = new Headers({ referer: 'not a url' })
      expect(sanitizeHeaders(headers)).toEqual({ referer: '[REDACTED]' })
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

    it('redacts PII params (username, email)', () => {
      const body =
        'grant_type=password&username=alice&email=alice%40example.test'
      expect(sanitizeFormBody(body)).toEqual({
        grant_type: 'password',
        username: '[REDACTED]',
        email: '[REDACTED]'
      })
    })

    it('redacts OAuth security params (state, nonce, assertion)', () => {
      const body =
        'client_id=abc&state=csrf-binding&nonce=replay-binding&assertion=jwt-credential'
      expect(sanitizeFormBody(body)).toEqual({
        client_id: 'abc',
        state: '[REDACTED]',
        nonce: '[REDACTED]',
        assertion: '[REDACTED]'
      })
    })

    it('redacts OIDC id_token params', () => {
      const body = 'id_token=jwt&id_token_hint=jwt-hint&client_id=abc'
      expect(sanitizeFormBody(body)).toEqual({
        id_token: '[REDACTED]',
        id_token_hint: '[REDACTED]',
        client_id: 'abc'
      })
    })

    it('redacts bracket-notation nested secret keys (user[password])', () => {
      const body = 'user%5Bpassword%5D=secret&user%5Bname%5D=alice'
      expect(sanitizeFormBody(body)).toEqual({
        'user[password]': '[REDACTED]',
        'user[name]': 'alice'
      })
    })

    it('strips query/fragment from URL-valued params (redirect_uri)', () => {
      const body =
        'grant_type=authorization_code&redirect_uri=https%3A%2F%2Fclient.example%2Fcb%3Fsession%3Dsecret%23frag'
      expect(sanitizeFormBody(body)).toEqual({
        grant_type: 'authorization_code',
        redirect_uri: 'https://client.example/cb'
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

    it('recurses into nested objects and arrays', () => {
      expect(
        sanitizeParams({
          client_name: 'My App',
          meta: { client_secret: 'shh', note: 'ok' },
          items: [{ password: 'p' }, { keep: 'v' }]
        })
      ).toEqual({
        client_name: 'My App',
        meta: { client_secret: '[REDACTED]', note: 'ok' },
        items: [{ password: '[REDACTED]' }, { keep: 'v' }]
      })
    })

    it('returns primitive and nullish values unchanged', () => {
      expect(sanitizeParams('a string')).toBe('a string')
      expect(sanitizeParams(42)).toBe(42)
      expect(sanitizeParams(null)).toBeNull()
      expect(sanitizeParams(undefined)).toBeUndefined()
    })

    it('returns non-plain objects as-is instead of flattening them to {}', () => {
      const date = new Date('2026-01-01T00:00:00.000Z')
      const regexp = /secret/i
      expect(sanitizeParams({ created: date, pattern: regexp })).toEqual({
        created: date,
        pattern: regexp
      })
      // The Date is returned by reference, not coerced to an empty object.
      expect(
        (sanitizeParams({ created: date }) as { created: Date }).created
      ).toBe(date)
    })

    it('redacts bracket-notation nested secret keys', () => {
      expect(
        sanitizeParams({ 'user[password]': 'secret', 'user[name]': 'alice' })
      ).toEqual({
        'user[password]': '[REDACTED]',
        'user[name]': 'alice'
      })
    })

    it('strips query/fragment from URL-valued params', () => {
      expect(
        sanitizeParams({
          redirect_uri: 'https://client.example/cb?session=secret#frag',
          client_id: 'abc'
        })
      ).toEqual({
        redirect_uri: 'https://client.example/cb',
        client_id: 'abc'
      })
    })

    it('strips query/fragment from each element of a URL-valued array', () => {
      expect(
        sanitizeParams({
          redirect_uris: [
            'https://client.example/cb?session=secret#token',
            'https://client.example/cb2?code=leak'
          ]
        })
      ).toEqual({
        redirect_uris: [
          'https://client.example/cb',
          'https://client.example/cb2'
        ]
      })
    })

    it('truncates oversized string values', () => {
      const big = 'a'.repeat(5000)
      const result = sanitizeParams({ client_name: big }) as {
        client_name: string
      }
      expect(result.client_name.length).toBeLessThan(big.length)
      expect(result.client_name).toContain('[truncated 3976 chars]')
    })

    it('caps the number of keys kept per object', () => {
      const wide: Record<string, string> = {}
      for (let i = 0; i < 250; i += 1) wide[`k${i}`] = 'v'
      const result = sanitizeParams(wide) as Record<string, unknown>
      // 100 kept keys + 1 truncation summary key.
      expect(Object.keys(result)).toHaveLength(101)
      expect(result['…']).toBe('[truncated 150 keys]')
    })

    it('bounds recursion depth so a deeply nested body cannot blow the stack', () => {
      // Build a payload far deeper than the cap; sanitizing must not throw.
      let deep: Record<string, unknown> = { secret: 'value' }
      for (let i = 0; i < 5000; i += 1) {
        deep = { nested: deep }
      }

      let result: unknown
      expect(() => {
        result = sanitizeParams(deep)
      }).not.toThrow()

      // The subtree below the depth cap is dropped, not walked.
      let cursor = result as Record<string, unknown>
      let depth = 0
      while (cursor && typeof cursor === 'object' && 'nested' in cursor) {
        cursor = cursor.nested as Record<string, unknown>
        depth += 1
      }
      expect(cursor).toBe('[TRUNCATED]')
      expect(depth).toBeLessThanOrEqual(8)
    })
  })
})
