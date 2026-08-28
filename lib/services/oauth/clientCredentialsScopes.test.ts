import { toClientCredentialsScopes } from './clientCredentialsScopes'

describe('toClientCredentialsScopes', () => {
  it.each([
    {
      description: 'keeps the scopes a Mastodon client registers with',
      scopes: ['read', 'write', 'follow', 'push'],
      expected: ['read', 'write', 'follow', 'push']
    },
    {
      description: 'keeps granular scopes untouched',
      scopes: ['read:statuses', 'write:media', 'admin:read:reports'],
      expected: ['read:statuses', 'write:media', 'admin:read:reports']
    },
    {
      description:
        'drops the scopes better-auth reserves for user-delegated grants',
      scopes: ['openid', 'profile', 'email', 'offline_access', 'read'],
      expected: ['read']
    },
    {
      description: 'deduplicates repeated scopes',
      scopes: ['read', 'read', 'write'],
      expected: ['read', 'write']
    },
    {
      description: 'denies the grant for an OpenID-only client',
      scopes: ['openid', 'email'],
      expected: []
    },
    {
      description: 'denies the grant for a client with no scopes at all',
      scopes: [],
      expected: []
    }
  ])('$description', ({ scopes, expected }) => {
    expect(toClientCredentialsScopes(scopes)).toEqual(expected)
  })

  it('does not mutate the scopes it is given', () => {
    const scopes = ['openid', 'read']
    toClientCredentialsScopes(scopes)
    expect(scopes).toEqual(['openid', 'read'])
  })
})
