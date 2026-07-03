// Catches an OAuth-scope-guarded route hard-coding the WRONG (but valid) scope
// literal. TypeScript accepts any Scope.enum member, so e.g. block listing
// write:mutes, or suggestions accepting read+write, compiles and passes every
// other test. This imports each converted route module with the guard factories
// mocked to record the scope array they receive, then asserts the recorded
// scopes match the expected set for that route.

const guardCalls: string[][] = []
vi.mock('@/lib/services/guards/OAuthGuard', () => {
  // Record the scope array and tag the returned handler with it so the
  // per-method assertions below can read each exported method's own scopes.
  const wrap = (scopes: string[], ..._rest: unknown[]) =>
    Object.assign(() => new Response(null), { __scopes: scopes })
  const record = (scopes: string[], ...rest: unknown[]) => {
    guardCalls.push(scopes)
    return wrap(scopes, ...rest)
  }
  return {
    OAuthGuard: record,
    OAuthGuardAnyScope: record,
    OptionalOAuthGuard: record,
    OAuthAppGuard: record,
    corsErrorResponse: () => () => new Response(null)
  }
})

// Pass traceApiRoute through so each exported method IS the tagged guard handler,
// letting the per-method assertions read `mod[METHOD].__scopes`.
vi.mock('@/lib/utils/traceApiRoute', () => ({
  traceApiRoute: (_name: string, handler: unknown) => handler
}))

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
  },
  // follow_requests authorize/reject
  {
    module: '@/app/api/v1/follow_requests/[id]/authorize/route',
    scopes: ['write', 'write:follows']
  },
  {
    module: '@/app/api/v1/follow_requests/[id]/reject/route',
    scopes: ['write', 'write:follows']
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

// The union assertion above cannot tell a GET<->mutation scope swap apart on
// multi-method routes (the flattened set is identical). Assert those routes
// per exported method.
type ScopedHandler = { __scopes?: string[] }
const MULTI_METHOD: Array<{
  module: string
  methods: Record<string, string[]>
}> = [
  {
    module: '@/app/api/v1/notifications/route',
    methods: {
      GET: ['read', 'read:notifications'],
      POST: ['write', 'write:notifications']
    }
  },
  {
    module: '@/app/api/v1/notifications/[id]/route',
    methods: {
      GET: ['read', 'read:notifications'],
      POST: ['write', 'write:notifications']
    }
  },
  {
    module: '@/app/api/v2/notifications/policy/route',
    methods: {
      GET: ['read', 'read:notifications'],
      PATCH: ['write', 'write:notifications']
    }
  }
]

describe('multi-method route scopes are wired per method', () => {
  it.each(MULTI_METHOD)('$module', async ({ module, methods }) => {
    const mod = (await import(module)) as Record<string, ScopedHandler>
    for (const [method, scopes] of Object.entries(methods)) {
      expect(unique(mod[method]?.__scopes ?? [])).toEqual(unique(scopes))
    }
  })
})
