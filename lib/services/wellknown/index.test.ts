import {
  getHostMetaXML,
  getNodeInfoLinks,
  getOAuthAuthorizationServerMetadata,
  getWebFingerResponse
} from './index'

jest.mock('../../config', () => ({
  getConfig: jest.fn().mockReturnValue({ host: 'test.example.com' })
}))

describe('wellknown services', () => {
  describe('#getOAuthAuthorizationServerMetadata', () => {
    it('returns correct OAuth authorization server metadata', () => {
      const metadata = getOAuthAuthorizationServerMetadata()

      expect(metadata).toMatchObject({
        issuer: 'https://test.example.com/',
        authorization_endpoint: 'https://test.example.com/oauth/authorize',
        token_endpoint: 'https://test.example.com/oauth/token',
        revocation_endpoint: 'https://test.example.com/oauth/revoke',
        response_types_supported: ['code'],
        response_modes_supported: ['query', 'fragment', 'form_post'],
        grant_types_supported: [
          'authorization_code',
          'password',
          'client_credentials'
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

      expect(metadata.scopes_supported).toContain('read')
      expect(metadata.scopes_supported).toContain('write')
      expect(metadata.scopes_supported).toContain('follow')
    })
  })

  describe('#getHostMetaXML', () => {
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

  describe('#getNodeInfoLinks', () => {
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
        href: 'https://test.example.com/.well-known/nodeinfo/2.0'
      })
    })
  })
})

describe('#getWebFingerResponse', () => {
  // Mock database for webfinger tests
  const mockDatabase = {
    getActorFromUsername: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null when resource format is invalid', async () => {
    const result = await getWebFingerResponse({
      database: mockDatabase as any,
      resource: 'invalidformat'
    })

    expect(result).toBeNull()
  })

  it('returns null when actor not found', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue(null)

    const result = await getWebFingerResponse({
      database: mockDatabase as any,
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
      database: mockDatabase as any,
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
      database: mockDatabase as any,
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
      database: mockDatabase as any,
      resource: 'acct:user@example.com'
    })

    expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
      username: 'user',
      domain: 'example.com'
    })
  })

  it('handles resource without acct: prefix', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue({
      id: 'https://example.com/users/user',
      username: 'user',
      domain: 'example.com',
      privateKey: 'key'
    })

    await getWebFingerResponse({
      database: mockDatabase as any,
      resource: 'user@example.com'
    })

    expect(mockDatabase.getActorFromUsername).toHaveBeenCalledWith({
      username: 'user',
      domain: 'example.com'
    })
  })
})
