import { Scope, UsableScopes } from './operations'

// The OAuth scope vocabulary is the compatibility contract with Mastodon
// clients. Mastodon rejects unknown scopes at app registration and at the
// authorize endpoint, so any scope a real Mastodon client may request must be
// recognized here or the client cannot connect at all. This list mirrors the
// documented Mastodon OAuth scopes:
// https://docs.joinmastodon.org/api/oauth-scopes/
const MASTODON_DOCUMENTED_SCOPES = [
  'profile',
  'read',
  'read:accounts',
  'read:blocks',
  'read:bookmarks',
  'read:favourites',
  'read:filters',
  'read:follows',
  'read:lists',
  'read:mutes',
  'read:notifications',
  'read:reports',
  'read:search',
  'read:statuses',
  'write',
  'write:accounts',
  'write:blocks',
  'write:bookmarks',
  'write:conversations',
  'write:favourites',
  'write:filters',
  'write:follows',
  'write:lists',
  'write:media',
  'write:mutes',
  'write:notifications',
  'write:reports',
  'write:statuses',
  'follow',
  'push',
  'admin:read',
  'admin:read:accounts',
  'admin:read:reports',
  'admin:read:domain_allows',
  'admin:read:domain_blocks',
  'admin:read:ip_blocks',
  'admin:read:email_domain_blocks',
  'admin:read:canonical_email_blocks',
  'admin:write',
  'admin:write:accounts',
  'admin:write:reports',
  'admin:write:domain_allows',
  'admin:write:domain_blocks',
  'admin:write:ip_blocks',
  'admin:write:email_domain_blocks',
  'admin:write:canonical_email_blocks'
]

describe('OAuth Scope vocabulary', () => {
  it('recognizes every documented Mastodon OAuth scope', () => {
    for (const scope of MASTODON_DOCUMENTED_SCOPES) {
      expect(Scope.options).toContain(scope)
    }
  })

  it('also recognizes the OpenID Connect scopes', () => {
    expect(Scope.options).toContain('openid')
    expect(Scope.options).toContain('email')
  })

  it('advertises exactly the recognized scopes (no drift between enum and UsableScopes)', () => {
    expect([...UsableScopes].sort()).toEqual([...Scope.options].sort())
  })
})
