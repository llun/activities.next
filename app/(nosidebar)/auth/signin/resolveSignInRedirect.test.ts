import { resolveSignInRedirect } from './resolveSignInRedirect'

describe('resolveSignInRedirect', () => {
  it('resumes an OIDC login redirect to the consent page without the login signature', () => {
    // Shape better-auth's loginPage redirect produces: the OAuth request plus
    // its signed envelope (exp/ba_iat/ba_param/sig) and NO redirectBack.
    const params = new URLSearchParams(
      'response_type=code&client_id=docs&redirect_uri=https%3A%2F%2Fdocs.llun.social%2Fcb' +
        '&scope=openid+profile&state=xyz' +
        '&exp=1700000600&ba_iat=1700000000000&ba_param=client_id&sig=ABC'
    )

    const result = resolveSignInRedirect(params)

    expect(result.startsWith('/oauth/authorize?')).toBe(true)
    const query = new URLSearchParams(result.split('?')[1])
    expect(query.get('response_type')).toBe('code')
    expect(query.get('client_id')).toBe('docs')
    expect(query.get('redirect_uri')).toBe('https://docs.llun.social/cb')
    expect(query.get('scope')).toBe('openid profile')
    expect(query.get('state')).toBe('xyz')
    // The login signature/envelope is dropped so the consent page re-delegates
    // to better-auth for a fresh consent signature.
    expect(query.has('sig')).toBe(false)
    expect(query.has('exp')).toBe(false)
    expect(query.has('ba_iat')).toBe(false)
    expect(query.has('ba_param')).toBe(false)
  })

  it('prefers a safe redirectBack over OIDC params', () => {
    const params = new URLSearchParams(
      'redirectBack=%2Ffitness&response_type=code&client_id=docs'
    )
    expect(resolveSignInRedirect(params)).toBe('/fitness')
  })

  it('preserves an existing /oauth/authorize redirectBack verbatim', () => {
    const back =
      '/oauth/authorize?client_id=docs&scope=openid&redirect_uri=https://x/cb&response_type=code'
    const params = new URLSearchParams()
    params.set('redirectBack', back)
    expect(resolveSignInRedirect(params)).toBe(back)
  })

  it.each([
    {
      description: 'a protocol-relative redirectBack',
      redirectBack: '//evil.com'
    },
    {
      description: 'an absolute redirectBack',
      redirectBack: 'https://evil.com'
    },
    { description: 'an empty redirectBack', redirectBack: '' },
    {
      description: 'a backslash-prefixed redirectBack (resolves off-origin)',
      redirectBack: '/\\evil.com'
    },
    {
      description: 'a tab-then-slash redirectBack (resolves off-origin)',
      redirectBack: '/\t/evil.com'
    }
  ])(
    'falls back to / for $description when there is no OIDC request',
    ({ redirectBack }) => {
      const params = new URLSearchParams()
      params.set('redirectBack', redirectBack)
      expect(resolveSignInRedirect(params)).toBe('/')
    }
  )

  it('falls back to / for a plain sign-in with no params', () => {
    expect(resolveSignInRedirect(new URLSearchParams())).toBe('/')
  })

  it('does not treat a non-code response_type as an OIDC request', () => {
    const params = new URLSearchParams('response_type=token&client_id=docs')
    expect(resolveSignInRedirect(params)).toBe('/')
  })

  it('does not resume when client_id is missing', () => {
    const params = new URLSearchParams('response_type=code')
    expect(resolveSignInRedirect(params)).toBe('/')
  })

  it('carries PKCE, nonce and prompt through the resume', () => {
    const params = new URLSearchParams(
      'response_type=code&client_id=docs&redirect_uri=https%3A%2F%2Fx%2Fcb&scope=openid' +
        '&code_challenge=abc&code_challenge_method=S256&nonce=n1&prompt=consent&sig=S&exp=1'
    )

    const query = new URLSearchParams(
      resolveSignInRedirect(params).split('?')[1]
    )
    expect(query.get('code_challenge')).toBe('abc')
    expect(query.get('code_challenge_method')).toBe('S256')
    expect(query.get('nonce')).toBe('n1')
    expect(query.get('prompt')).toBe('consent')
    expect(query.has('sig')).toBe(false)
  })

  it('ignores an unsafe redirectBack and resumes the OIDC request instead', () => {
    // redirectBack=/\evil.com is an open-redirect attempt; it must be dropped,
    // and the genuine OIDC request resumed rather than falling back to '/'.
    const params = new URLSearchParams(
      'redirectBack=%2F%5Cevil.com&response_type=code&client_id=docs' +
        '&redirect_uri=https%3A%2F%2Fx%2Fcb&scope=openid'
    )

    const result = resolveSignInRedirect(params)
    expect(result.startsWith('/oauth/authorize?')).toBe(true)
    expect(new URLSearchParams(result.split('?')[1]).get('client_id')).toBe(
      'docs'
    )
  })

  it('does not resume when client_id is an empty string', () => {
    const params = new URLSearchParams('response_type=code&client_id=')
    expect(resolveSignInRedirect(params)).toBe('/')
  })

  it('carries request_uri (PAR) through the resume', () => {
    const params = new URLSearchParams(
      'response_type=code&client_id=docs' +
        '&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Aabc'
    )

    const query = new URLSearchParams(
      resolveSignInRedirect(params).split('?')[1]
    )
    expect(query.get('request_uri')).toBe(
      'urn:ietf:params:oauth:request_uri:abc'
    )
  })
})
