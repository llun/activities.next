// Catches an OAuth-scope-guarded route hard-coding the WRONG (but valid) scope
// literal. TypeScript accepts any Scope.enum member, so e.g. block listing
// write:mutes, or suggestions accepting read+write, compiles and passes every
// other test. This imports each converted route module with the guard factories
// mocked to record the scope array they receive, then asserts the recorded
// scopes match the expected set for that route.

const guardCalls: string[][] = []
vi.mock('@/lib/services/guards/OAuthGuard', () => {
  const wrap = (scopes: string[], ..._rest: unknown[]) => {
    guardCalls.push(scopes)
    return () => new Response(null)
  }
  return {
    OAuthGuard: wrap,
    OAuthGuardAnyScope: wrap,
    OptionalOAuthGuard: wrap,
    OAuthAppGuard: wrap,
    corsErrorResponse: () => () => new Response(null)
  }
})

// Route module -> the exact set of scope strings it should pass across all its
// guarded methods (deduped). Kept independent of the route source so a wrong
// literal is caught.
const EXPECTED: Array<{ module: string; scopes: string[] }> = [
  // account actions
  {
    module: '@/app/api/v1/accounts/[id]/follow/route',
    scopes: ['write', 'write:follows']
  },
  {
    module: '@/app/api/v1/accounts/[id]/unfollow/route',
    scopes: ['write', 'write:follows']
  },
  {
    module: '@/app/api/v1/accounts/[id]/block/route',
    scopes: ['write', 'write:blocks']
  },
  {
    module: '@/app/api/v1/accounts/[id]/unblock/route',
    scopes: ['write', 'write:blocks']
  },
  {
    module: '@/app/api/v1/accounts/[id]/mute/route',
    scopes: ['write', 'write:mutes']
  },
  {
    module: '@/app/api/v1/accounts/[id]/unmute/route',
    scopes: ['write', 'write:mutes']
  },
  {
    module: '@/app/api/v1/accounts/[id]/note/route',
    scopes: ['write', 'write:accounts']
  },
  // status actions
  {
    module: '@/app/api/v1/statuses/[id]/favourite/route',
    scopes: ['write', 'write:favourites']
  },
  {
    module: '@/app/api/v1/statuses/[id]/unfavourite/route',
    scopes: ['write', 'write:favourites']
  },
  {
    module: '@/app/api/v1/statuses/[id]/reblog/route',
    scopes: ['write', 'write:statuses']
  },
  {
    module: '@/app/api/v1/statuses/[id]/unreblog/route',
    scopes: ['write', 'write:statuses']
  },
  {
    module: '@/app/api/v1/statuses/[id]/reblogged_by/route',
    scopes: ['read', 'read:accounts']
  },
  {
    module: '@/app/api/v1/statuses/[id]/favourited_by/route',
    scopes: ['read', 'read:accounts']
  },
  // polls
  {
    module: '@/app/api/v1/polls/[id]/route',
    scopes: ['read', 'read:statuses']
  },
  {
    module: '@/app/api/v1/polls/[id]/votes/route',
    scopes: ['write', 'write:statuses']
  },
  // preferences
  {
    module: '@/app/api/v1/preferences/route',
    scopes: ['read', 'read:accounts']
  },
  // announcements
  {
    module: '@/app/api/v1/announcements/[id]/dismiss/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/announcements/[id]/reactions/[name]/route',
    scopes: ['write', 'write:favourites']
  },
  // suggestions (Mastodon: read)
  { module: '@/app/api/v1/suggestions/[account_id]/route', scopes: ['read'] },
  // v1 notifications
  {
    module: '@/app/api/v1/notifications/route',
    scopes: ['read', 'read:notifications', 'write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/clear/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/read/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/unread_count/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v1/notifications/[id]/route',
    scopes: ['read', 'read:notifications', 'write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/[id]/dismiss/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/merged/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/accept/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/dismiss/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/[id]/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/[id]/accept/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/[id]/dismiss/route',
    scopes: ['write', 'write:notifications']
  },
  // v2 notifications
  {
    module: '@/app/api/v2/notifications/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v2/notifications/unread_count/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v2/notifications/policy/route',
    scopes: ['read', 'read:notifications', 'write', 'write:notifications']
  },
  {
    module: '@/app/api/v2/notifications/[group_key]/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v2/notifications/[group_key]/accounts/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v2/notifications/[group_key]/dismiss/route',
    scopes: ['write', 'write:notifications']
  },
  // userinfo
  {
    module: '@/app/api/oauth/userinfo/route',
    scopes: ['openid', 'profile', 'read']
  }
]

const unique = (scopes: string[]) => [...new Set(scopes)].sort()

describe('OAuth scope guard wiring', () => {
  beforeEach(() => {
    guardCalls.length = 0
  })

  it.each(EXPECTED)(
    '$module guards with the expected scopes',
    async ({ module, scopes }) => {
      await import(module)
      expect(unique(guardCalls.flat())).toEqual(unique(scopes))
    }
  )
})
