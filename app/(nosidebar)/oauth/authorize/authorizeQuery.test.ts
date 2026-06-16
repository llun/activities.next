import {
  buildBetterAuthAuthorizeUrl,
  buildOAuthAuthorizePath,
  buildOAuthQuery,
  shouldDelegateToBetterAuth
} from './authorizeQuery'
import { SearchParams } from './types'

const unsignedParams: SearchParams = {
  client_id: 'phanpy-client',
  redirect_uri: 'https://phanpy.local/?from=login',
  response_type: 'code',
  scope: 'read write follow push',
  state: 'state with spaces',
  code_challenge: 'challenge/with+symbols=',
  code_challenge_method: 'S256'
}

describe('OAuth authorize query helpers', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockImplementation(() => 1700000000000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('delegates unsigned Mastodon-compatible authorize requests to Better Auth', () => {
    expect(shouldDelegateToBetterAuth(unsignedParams)).toBe(true)

    const authorizeUrl = new URL(
      buildBetterAuthAuthorizeUrl(unsignedParams, 'https://activities.local')
    )

    expect(authorizeUrl.origin).toBe('https://activities.local')
    expect(authorizeUrl.pathname).toBe('/api/auth/oauth2/authorize')
    expect(authorizeUrl.searchParams.get('client_id')).toBe('phanpy-client')
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
      'https://phanpy.local/?from=login'
    )
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code')
    expect(authorizeUrl.searchParams.get('scope')).toBe(
      'read write follow push'
    )
    expect(authorizeUrl.searchParams.get('state')).toBe('state with spaces')
    expect(authorizeUrl.searchParams.get('code_challenge')).toBe(
      'challenge/with+symbols='
    )
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizeUrl.searchParams.has('sig')).toBe(false)
    expect(authorizeUrl.searchParams.has('exp')).toBe(false)
  })

  it('preserves the raw authorize path for sign-in redirectBack', () => {
    const redirectBack = new URL(
      buildOAuthAuthorizePath(unsignedParams),
      'https://activities.local'
    )

    expect(redirectBack.pathname).toBe('/oauth/authorize')
    expect(redirectBack.searchParams.get('client_id')).toBe('phanpy-client')
    expect(redirectBack.searchParams.get('redirect_uri')).toBe(
      'https://phanpy.local/?from=login'
    )
    expect(redirectBack.searchParams.get('scope')).toBe(
      'read write follow push'
    )
    expect(redirectBack.searchParams.get('code_challenge')).toBe(
      'challenge/with+symbols='
    )
  })

  it('treats signed Better Auth params as consent-page params', () => {
    const signedParams: SearchParams = {
      ...unsignedParams,
      sig: 'signed-query',
      exp: '1779800000'
    }

    expect(shouldDelegateToBetterAuth(signedParams)).toBe(false)

    const oauthQuery = new URLSearchParams(buildOAuthQuery(signedParams))

    expect(oauthQuery.get('client_id')).toBe('phanpy-client')
    expect(oauthQuery.get('scope')).toBe('read write follow push')
    expect(oauthQuery.get('sig')).toBe('signed-query')
    expect(oauthQuery.get('exp')).toBe('1779800000')
  })

  it('treats Better Auth signed exp values as epoch seconds', () => {
    const signedParams: SearchParams = {
      ...unsignedParams,
      sig: 'signed-query',
      // Representative 10-digit value emitted by Better Auth signParams.
      exp: '1779815588'
    }

    expect(shouldDelegateToBetterAuth(signedParams)).toBe(false)
  })

  it('serializes signed consent queries in Better Auth signature order', () => {
    const signedParams: SearchParams = {
      ...unsignedParams,
      prompt: 'consent',
      exp: '1779800000',
      sig: 'signature/with+symbols='
    }

    expect(buildOAuthQuery(signedParams)).toBe(
      'response_type=code' +
        '&client_id=phanpy-client' +
        '&redirect_uri=https%3A%2F%2Fphanpy.local%2F%3Ffrom%3Dlogin' +
        '&scope=read+write+follow+push' +
        '&state=state+with+spaces' +
        '&code_challenge=challenge%2Fwith%2Bsymbols%3D' +
        '&code_challenge_method=S256' +
        '&prompt=consent' +
        '&exp=1779800000' +
        '&sig=signature%2Fwith%2Bsymbols%3D'
    )
  })

  it('skips nullish values when serializing query params', () => {
    const paramsWithNullValue = {
      ...unsignedParams,
      state: null,
      exp: '1779800000',
      sig: 'signed-query'
    } as unknown as SearchParams

    const oauthQuery = new URLSearchParams(buildOAuthQuery(paramsWithNullValue))

    expect(oauthQuery.has('state')).toBe(false)
    expect(oauthQuery.get('sig')).toBe('signed-query')
    expect(oauthQuery.get('exp')).toBe('1779800000')
  })

  it('preserves request_uri params for Better Auth authorization queries', () => {
    const paramsWithRequestUri: SearchParams = {
      ...unsignedParams,
      request_uri: 'urn:ietf:params:oauth:request_uri:request-id'
    }

    const oauthQuery = new URLSearchParams(
      buildOAuthQuery(paramsWithRequestUri)
    )

    expect(oauthQuery.get('request_uri')).toBe(
      'urn:ietf:params:oauth:request_uri:request-id'
    )
  })

  it('skips blank Better Auth signature params when delegating', () => {
    const partialSignatureParams: SearchParams = {
      ...unsignedParams,
      sig: '',
      exp: '1779800000'
    }

    expect(shouldDelegateToBetterAuth(partialSignatureParams)).toBe(true)

    const authorizeUrl = new URL(
      buildBetterAuthAuthorizeUrl(
        partialSignatureParams,
        'https://activities.local'
      )
    )

    expect(authorizeUrl.searchParams.has('sig')).toBe(false)
    expect(authorizeUrl.searchParams.has('exp')).toBe(false)
  })

  it('delegates when only one Better Auth signature param is present', () => {
    expect(
      shouldDelegateToBetterAuth({
        ...unsignedParams,
        sig: 'partial-signature'
      })
    ).toBe(true)
    expect(
      shouldDelegateToBetterAuth({
        ...unsignedParams,
        exp: '1779800000'
      })
    ).toBe(true)
  })

  it('delegates expired or malformed Better Auth signature params', () => {
    const expiredSignatureParams: SearchParams = {
      ...unsignedParams,
      sig: 'expired-signature',
      exp: '1699999999'
    }

    expect(shouldDelegateToBetterAuth(expiredSignatureParams)).toBe(true)
    expect(
      shouldDelegateToBetterAuth({
        ...unsignedParams,
        sig: 'malformed-signature',
        exp: 'not-a-number'
      })
    ).toBe(true)

    const authorizeUrl = new URL(
      buildBetterAuthAuthorizeUrl(
        expiredSignatureParams,
        'https://activities.local'
      )
    )

    expect(authorizeUrl.searchParams.has('sig')).toBe(false)
    expect(authorizeUrl.searchParams.has('exp')).toBe(false)
  })
})
