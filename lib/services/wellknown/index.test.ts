import { Database } from '@/lib/database/types'
import { AUTH_BASE_PATH } from '@/lib/services/auth/constants'

import {
  getHostMetaXML,
  getNodeInfo20,
  getNodeInfoLinks,
  getOAuthAuthorizationServerMetadata,
  getOpenIDConfiguration,
  getWebFingerResponse
} from './index'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({ host: 'test.example.com' }),
  getBaseURL: vi.fn().mockReturnValue('https://test.example.com')
}))

describe('wellknown services', () => {
  describe('getOAuthAuthorizationServerMetadata', () => {
    it('returns correct OAuth authorization server metadata', () => {
      const metadata = getOAuthAuthorizationServerMetadata()

      expect(metadata).toMatchObject({
        issuer: 'https://test.example.com',
        authorization_endpoint:
          'https://test.example.com/api/auth/oauth2/authorize',
        token_endpoint: 'https://test.example.com/oauth/token',
        revocation_endpoint: 'https://test.example.com/oauth/revoke',
        userinfo_endpoint: 'https://test.example.com/oauth/userinfo',
        jwks_uri: 'https://test.example.com/api/auth/jwks',
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: [
          'authorization_code',
          'client_credentials',
          'refresh_token'
        ],
        token_endpoint_auth_methods_supported: [
          'client_secret_basic',
          'client_secret_post'
        ],
        code_challenge_methods_supported: ['S256'],
        service_documentation: 'https://github.com/llun/activities.next',
        app_registration_endpoint: 'https://test.example.com/api/v1/apps'
      })
    })

    it('includes supported scopes', () => {
      const metadata = getOAuthAuthorizationServerMetadata()

      expect(metadata.scopes_supported).toContain('openid')
      expect(metadata.scopes_supported).toContain('profile')
      expect(metadata.scopes_supported).toContain('email')
      expect(metadata.scopes_supported).toContain('read')
      expect(metadata.scopes_supported).toContain('read:bookmarks')
      expect(metadata.scopes_supported).toContain('write')
      expect(metadata.scopes_supported).toContain('write:accounts')
      expect(metadata.scopes_supported).toContain('write:bookmarks')
      expect(metadata.scopes_supported).toContain('follow')
      expect(metadata.scopes_supported).toContain('push')
    })
  })

  describe('getOpenIDConfiguration', () => {
    it('returns correct OpenID Connect discovery metadata', () => {
      const config = getOpenIDConfiguration()

      expect(config).toMatchObject({
        // Better Auth signs id_tokens with iss = baseURL + basePath
        // (`/api/auth`), so discovery must advertise that same issuer.
        issuer: 'https://test.example.com/api/auth',
        authorization_endpoint:
          'https://test.example.com/api/auth/oauth2/authorize',
        token_endpoint: 'https://test.example.com/oauth/token',
        userinfo_endpoint: 'https://test.example.com/oauth/userinfo',
        jwks_uri: 'https://test.example.com/api/auth/jwks',
        revocation_endpoint: 'https://test.example.com/oauth/revoke',
        end_session_endpoint:
          'https://test.example.com/api/auth/oauth2/end-session',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: [
          'client_secret_basic',
          'client_secret_post'
        ],
        code_challenge_methods_supported: ['S256']
      })
    })

    it('advertises the basePath issuer that Better Auth stamps on id_tokens', () => {
      const config = getOpenIDConfiguration()

      // The id_token `iss` is baseURL + basePath; discovery must match it
      // exactly or a strict OIDC relying party rejects the token.
      expect(config.issuer).toBe('https://test.example.com/api/auth')
    })

    it('advertises the RP-initiated logout end_session_endpoint under the issuer', () => {
      // django-lasuite/mozilla-django-oidc reads `end_session_endpoint` from
      // discovery to perform single logout against this instance.
      const config = getOpenIDConfiguration()

      expect(config.end_session_endpoint).toBe(
        'https://test.example.com/api/auth/oauth2/end-session'
      )
    })

    it('builds the issuer and logout endpoint from the shared AUTH_BASE_PATH constant', () => {
      // `auth.ts` passes `AUTH_BASE_PATH` to better-auth as `basePath`, and the
      // discovery doc builds its `issuer`/endpoints from the same constant, so
      // the advertised issuer tracks the basePath the id_token `iss` is signed
      // under (the value the end-session check enforces). This asserts the
      // discovery side of that coupling — that the issuer and end_session_endpoint
      // are derived from AUTH_BASE_PATH, not a divergent hardcoded literal. (It
      // can't observe `auth.ts`'s `basePath` wiring directly; that side is held
      // by both consuming this one exported constant.)
      const config = getOpenIDConfiguration()

      expect(config.issuer).toBe(`https://test.example.com${AUTH_BASE_PATH}`)
      expect(config.end_session_endpoint).toBe(
        `${config.issuer}/oauth2/end-session`
      )
    })

    it('keeps a distinct issuer from the RFC 8414 OAuth metadata (bare origin)', () => {
      // OAuth2 access tokens carry no `iss`, so the authorization-server
      // metadata intentionally keeps the bare origin for Mastodon compatibility.
      // Only the OIDC discovery issuer gains the `/api/auth` basePath.
      const oidc = getOpenIDConfiguration()
      const oauth = getOAuthAuthorizationServerMetadata()

      expect(oauth.issuer).toBe('https://test.example.com')
      expect(oidc.issuer).not.toBe(oauth.issuer)
      expect(oidc.issuer).toBe(`${oauth.issuer}/api/auth`)
    })

    it('includes OIDC scopes and claims', () => {
      const config = getOpenIDConfiguration()

      expect(config.scopes_supported).toContain('openid')
      expect(config.scopes_supported).toContain('profile')
      expect(config.scopes_supported).toContain('email')
      expect(config.scopes_supported).toContain('read:bookmarks')
      expect(config.scopes_supported).toContain('write:accounts')
      expect(config.scopes_supported).toContain('write:bookmarks')
      expect(config.scopes_supported).toContain('push')
      expect(config.claims_supported).toContain('sub')
      expect(config.claims_supported).toContain('name')
      expect(config.claims_supported).toContain('email')
      expect(config.claims_supported).toContain('email_verified')
      expect(config.claims_supported).toContain('preferred_username')
    })
  })

  describe('getHostMetaXML', () => {
    it('returns valid XRD XML with webfinger template', () => {
      const xml = getHostMetaXML()

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(xml).toContain(
        '<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">'
      )
      expect(xml).toContain('rel="lrdd"')
      expect(xml).toContain(
        'template="https://test.example.com/.well-known/webfinger?resource={uri}"'
      )
      expect(xml).toContain('</XRD>')
    })
  })

  describe('getNodeInfoLinks', () => {
    it('returns nodeinfo links array', () => {
      const nodeInfoLinks = getNodeInfoLinks()

      expect(nodeInfoLinks).toHaveProperty('links')
      expect(nodeInfoLinks.links).toBeArray()
      expect(nodeInfoLinks.links).toHaveLength(1)
    })

    it('includes nodeinfo 2.0 schema link', () => {
      const nodeInfoLinks = getNodeInfoLinks()

      expect(nodeInfoLinks.links[0]).toMatchObject({
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: 'https://test.example.com/nodeinfo/2.0'
      })
    })
  })

  describe('getNodeInfo20', () => {
    const stats = {
      totalUsers: 5,
      activeMonth: 3,
      activeHalfyear: 4,
      localPosts: 42
    }

    it('returns a spec-compliant NodeInfo 2.0 document', () => {
      const nodeInfo = getNodeInfo20(stats)

      expect(nodeInfo).toMatchObject({
        version: '2.0',
        protocols: ['activitypub'],
        services: { inbound: [], outbound: [] },
        openRegistrations: false,
        usage: {
          users: { total: 5, activeMonth: 3, activeHalfyear: 4 },
          localPosts: 42,
          localComments: 0
        }
      })
    })

    it('uses a schema-safe software.name (^[a-z0-9-]+$)', () => {
      const nodeInfo = getNodeInfo20(stats)

      expect(nodeInfo.software.name).toMatch(/^[a-z0-9-]+$/)
      expect(nodeInfo.software).toHaveProperty('version')
    })

    it('falls back to host for nodeName when serviceName is unset', () => {
      const nodeInfo = getNodeInfo20(stats)

      expect(nodeInfo.metadata).toEqual({
        nodeName: 'test.example.com',
        nodeDescription: ''
      })
    })
  })
})

describe('getWebFingerResponse', () => {
  // Mock database for webfinger tests
  const mockDatabase = {
    getActorFromUsername: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when resource format is invalid', async () => {
    const result = await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'invalidformat'
    })

    expect(result).toBeNull()
  })

  it('returns null when account resource contains multiple at signs', async () => {
    const result = await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'acct:user@example.com@elsewhere.test'
    })

    expect(result).toBeNull()
    expect(mockDatabase.getActorFromUsername).not.toHaveBeenCalled()
  })

  it('returns null when actor not found', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue(null)

    const result = await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'acct:user@example.com'
    })

    expect(result).toBeNull()
  })

  it('returns null for non-local actors (no privateKey)', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue({
      id: 'https://example.com/users/test',
      username: 'test',
      domain: 'example.com',
      privateKey: null
    })

    const result = await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'acct:test@example.com'
    })

    expect(result).toBeNull()
  })

  it('returns valid webfinger response for local actor', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue({
      id: 'https://example.com/users/test',
      username: 'test',
      domain: 'example.com',
      privateKey: 'some-private-key'
    })

    const result = await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'acct:test@example.com'
    })

    expect(result).toMatchObject({
      subject: 'acct:test@example.com',
      aliases: ['https://example.com/@test', 'https://example.com/users/test'],
      links: expect.arrayContaining([
        expect.objectContaining({
          rel: 'http://webfinger.net/rel/profile-page',
          type: 'text/html',
          href: 'https://example.com/@test'
        }),
        expect.objectContaining({
          rel: 'self',
          type: 'application/activity+json',
          href: 'https://example.com/users/test'
        })
      ])
    })
  })

  it('handles acct: prefix correctly', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue({
      id: 'https://example.com/users/user',
      username: 'user',
      domain: 'example.com',
      privateKey: 'key'
    })

    await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'acct:user@example.com'
    })

    expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
      username: 'user',
      domain: 'example.com'
    })
  })

  it('uses the requested domain casing before falling back to normalized domain casing', async () => {
    mockDatabase.getActorFromUsername
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'https://example.com/users/user',
        username: 'user',
        domain: 'example.com',
        privateKey: 'key'
      })

    await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'ACCT:user@EXAMPLE.COM'
    })

    expect(mockDatabase.getActorFromUsername).toHaveBeenNthCalledWith(1, {
      username: 'user',
      domain: 'EXAMPLE.COM'
    })
    expect(mockDatabase.getActorFromUsername).toHaveBeenNthCalledWith(2, {
      username: 'user',
      domain: 'example.com'
    })
  })

  it('preserves stored domain casing when the exact lookup matches', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue({
      id: 'https://Example.COM/users/user',
      username: 'user',
      domain: 'Example.COM',
      privateKey: 'key'
    })

    const result = await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'ACCT:user@Example.COM'
    })

    expect(mockDatabase.getActorFromUsername).toHaveBeenCalledTimes(1)
    expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
      username: 'user',
      domain: 'Example.COM'
    })
    expect(result?.subject).toBe('acct:user@Example.COM')
    expect(result?.aliases).toEqual([
      'https://Example.COM/@user',
      'https://Example.COM/users/user'
    ])
  })

  it('handles resource without acct: prefix', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue({
      id: 'https://example.com/users/user',
      username: 'user',
      domain: 'example.com',
      privateKey: 'key'
    })

    await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'user@example.com'
    })

    expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
      username: 'user',
      domain: 'example.com'
    })
  })

  it('returns aliases and self links from the canonical actor id', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue({
      id: 'https://fitness.example/users/runner',
      username: 'runner',
      domain: 'fitness.example',
      privateKey: 'key'
    })

    const result = await getWebFingerResponse({
      database: mockDatabase as unknown as Database,
      resource: 'acct:runner@fitness.example'
    })

    expect(result).toMatchObject({
      subject: 'acct:runner@fitness.example',
      aliases: [
        'https://fitness.example/@runner',
        'https://fitness.example/users/runner'
      ],
      links: expect.arrayContaining([
        expect.objectContaining({
          rel: 'self',
          type: 'application/activity+json',
          href: 'https://fitness.example/users/runner'
        }),
        expect.objectContaining({
          rel: 'self',
          type: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
          href: 'https://fitness.example/users/runner'
        })
      ])
    })
  })
})
