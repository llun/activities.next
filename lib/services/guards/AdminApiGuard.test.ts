import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { oauthLogger } from '@/lib/services/oauth/logging'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { HttpMethod } from '@/lib/utils/http-headers'

import { AdminApiGuard } from './AdminApiGuard'
import { hasGrantedScope } from './scopeHierarchy'

// Mock auth session
const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

// Mock database getter
let mockDatabase:
  ReturnType<typeof getTestSQLDatabaseWithInstance>['database'] | null = null
// The access-token row the real OAuthGuardAnyScope finds when a test drives it
// (see 'through the real OAuthGuardAnyScope'); null means "token not found".
let mockStoredToken: Record<string, unknown> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => (_table: string) => ({
    where: (_field: string, _value: string) => ({
      first: () => Promise.resolve(mockStoredToken)
    })
  })
}))

// Mock cookies from next/headers
const mockCookieValue: { value?: string } = {}
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() =>
    Promise.resolve({
      get: (name: string) => {
        if (name === 'activities.actor-id') {
          return mockCookieValue.value
            ? { value: mockCookieValue.value }
            : undefined
        }
        return undefined
      }
    })
  )
}))

// Mock config
vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    allowEmails: []
  }),
  getBaseURL: () => 'https://llun.test'
}))

// Mock OAuthGuardAnyScope for bearer token tests while preserving actual helper functions
const mockOAuthGuardAnyScope = vi.fn()
let mockOAuthActor = {
  account: { role: 'admin' }
} as Actor
// The scopes the bearer token was granted. The OAuthGuardAnyScope stand-in
// applies the real any-of scope match against them, so a test can assert the
// outcome (admitted or refused) of a token's consent, not just the scope list.
let mockGrantedScopes: string[] = ['admin:read', 'admin:write']

vi.mock('./OAuthGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./OAuthGuard')>()
  return {
    ...actual,
    OAuthGuardAnyScope: (...params: unknown[]) =>
      mockOAuthGuardAnyScope(...params)
  }
})

describe('AdminApiGuard', () => {
  const { database, instance } = getTestSQLDatabaseWithInstance()
  let adminActor: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database

    const actor = await database.getActorFromEmail({ email: seedActor1.email })
    if (!actor?.account) throw new Error('Admin actor account not found')
    adminActor = actor
    await instance('accounts')
      .where('id', actor.account.id)
      .update({ role: 'admin' })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieValue.value = undefined
    mockOAuthActor = {
      account: { role: 'admin' }
    } as Actor
    mockGrantedScopes = ['admin:read', 'admin:write']
    mockGetServerSession.mockResolvedValue(null)
    mockOAuthGuardAnyScope.mockImplementation(
      (
        scopes: Scope[],
        handle: (
          req: NextRequest,
          context: {
            currentActor: Actor
            database: typeof database
            params: Promise<{}>
          }
        ) => Promise<Response> | Response
      ) =>
        (req: NextRequest, context: { params: Promise<{}> }) => {
          if (
            !scopes.some((scope) => hasGrantedScope(mockGrantedScopes, scope))
          ) {
            // Mirrors OAuthGuard's insufficient_scope answer, which is a bare
            // 401 (rejectBearer('insufficient_scope', 401)), not a 403. The
            // 'through the real OAuthGuardAnyScope' tests pin the real status.
            return NextResponse.json(
              { error: 'The access token is invalid' },
              { status: 401 }
            )
          }
          return handle(req, {
            currentActor: mockOAuthActor,
            database,
            params: context.params
          })
        }
    )
  })

  const handle = vi.fn(() => NextResponse.json({ ok: true }))

  const createRequest = (
    method: string = 'GET',
    headers: Record<string, string> = {}
  ) => {
    return new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
      method,
      headers
    })
  }

  describe('with valid admin cookie session', () => {
    it('allows an admin cookie session', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(handle).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.objectContaining({
          database,
          moderator: {
            accountId: adminActor.account!.id,
            actorId: adminActor.account!.defaultActorId ?? null
          }
        })
      )
      expect(mockOAuthGuardAnyScope).not.toHaveBeenCalled()
    })

    it('rejects a non-admin cookie session', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
      expect(handle).not.toHaveBeenCalled()
    })
  })

  describe('same-origin proof for state-changing requests', () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
    })

    it('rejects a mutation without an Origin or Referer header', async () => {
      const guard = AdminApiGuard(
        [HttpMethod.enum.GET, HttpMethod.enum.POST],
        handle
      )
      const req = createRequest('POST')
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
      expect(handle).not.toHaveBeenCalled()
    })

    it('rejects a mutation with a cross-site Origin header', async () => {
      const guard = AdminApiGuard(
        [HttpMethod.enum.GET, HttpMethod.enum.POST],
        handle
      )
      const req = createRequest('POST', { Origin: 'https://attacker.test' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
      expect(handle).not.toHaveBeenCalled()
    })

    it('allows a mutation with a same-origin Origin header', async () => {
      const guard = AdminApiGuard(
        [HttpMethod.enum.GET, HttpMethod.enum.POST],
        handle
      )
      const req = createRequest('POST', { Origin: 'https://llun.test' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(handle).toHaveBeenCalled()
    })

    it('allows a mutation with a same-origin Referer header', async () => {
      const guard = AdminApiGuard(
        [HttpMethod.enum.GET, HttpMethod.enum.POST],
        handle
      )
      const req = createRequest('POST', {
        Referer: 'https://llun.test/admin'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(handle).toHaveBeenCalled()
    })

    it('does not require same-origin proof for GET requests', async () => {
      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const req = createRequest('GET')
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(handle).toHaveBeenCalled()
    })
  })

  describe('moderation blocked actors and accounts', () => {
    it('returns 403 for a suspended admin actor on a session created before suspension', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      await database.setActorSuspended({
        actorId: adminActor.id,
        suspended: true
      })

      try {
        const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
        expect(handle).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: adminActor.id,
          suspended: false
        })
      }
    })

    it('returns 403 for a disabled admin account on a session created before disablement', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      await database.setAccountDisabled({
        accountId: adminActor.account!.id,
        disabled: true
      })

      try {
        const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
        expect(handle).not.toHaveBeenCalled()
      } finally {
        await database.setAccountDisabled({
          accountId: adminActor.account!.id,
          disabled: false
        })
      }
    })

    it('allows silenced admin actors to proceed', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      await database.setActorSilenced({
        actorId: adminActor.id,
        silenced: true
      })

      try {
        const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(200)
        expect(handle).toHaveBeenCalled()
      } finally {
        await database.setActorSilenced({
          actorId: adminActor.id,
          silenced: false
        })
      }
    })
  })

  describe('unconfirmed admin accounts', () => {
    const PENDING_EMAIL = 'pending-admin-guard@llun.test'
    const PENDING_USERNAME = 'pendingadminguard'
    let pendingActorId: string
    let pendingAccountId: string

    beforeAll(async () => {
      pendingAccountId = await database.createAccount({
        domain: 'llun.test',
        email: PENDING_EMAIL,
        username: PENDING_USERNAME,
        passwordHash: 'pending-password-hash',
        privateKey: 'pending-private-key',
        publicKey: 'pending-public-key',
        verificationCode: 'pending-admin-guard-code'
      })
      await instance('accounts')
        .where('id', pendingAccountId)
        .update({ role: 'admin' })
      const actor = await database.getActorFromEmail({ email: PENDING_EMAIL })
      if (!actor?.account)
        throw new Error('Pending admin actor account not found')
      pendingActorId = actor.id
    })

    it('returns 403 for an unconfirmed admin account session', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: PENDING_EMAIL }
      })

      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
      expect(handle).not.toHaveBeenCalled()
    })

    it('still refuses a suspended unconfirmed admin actor', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: PENDING_EMAIL }
      })
      await database.setActorSuspended({
        actorId: pendingActorId,
        suspended: true
      })

      try {
        const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        expect(handle).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: pendingActorId,
          suspended: false
        })
      }
    })

    it('still refuses a disabled unconfirmed admin account', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: PENDING_EMAIL }
      })
      await database.setAccountDisabled({
        accountId: pendingAccountId,
        disabled: true
      })

      try {
        const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        expect(handle).not.toHaveBeenCalled()
      } finally {
        await database.setAccountDisabled({
          accountId: pendingAccountId,
          disabled: false
        })
      }
    })
  })

  describe('the 2026-03-20 backfilled cohort', () => {
    const COHORT_EMAIL = 'cohort-admin-guard@llun.test'
    const COHORT_USERNAME = 'cohortadminguard'

    beforeAll(async () => {
      const accountId = await database.createAccount({
        domain: 'llun.test',
        email: COHORT_EMAIL,
        username: COHORT_USERNAME,
        passwordHash: 'cohort-password-hash',
        privateKey: 'cohort-private-key',
        publicKey: 'cohort-public-key',
        verificationCode: 'stale-verification-code'
      })
      await instance('accounts')
        .where('id', accountId)
        .update({ role: 'admin', emailVerified: true })
    })

    it('admits a backfilled cohort admin account with outstanding verification code and emailVerified true', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: COHORT_EMAIL }
      })

      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(handle).toHaveBeenCalled()
    })
  })

  describe('admin account with no actor', () => {
    const ACTORLESS_EMAIL = 'actorless-admin@llun.test'
    const actorlessAccountId = crypto.randomUUID()

    beforeAll(async () => {
      const now = new Date()
      await instance('accounts').insert({
        id: actorlessAccountId,
        email: ACTORLESS_EMAIL,
        role: 'admin',
        emailVerified: true,
        verifiedAt: now,
        approvedAt: now,
        createdAt: now,
        updatedAt: now
      })
    })

    it('admits an active actorless admin account and resolves actorId null', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: ACTORLESS_EMAIL }
      })

      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(handle).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.objectContaining({
          moderator: {
            accountId: actorlessAccountId,
            actorId: null
          }
        })
      )
    })

    it('returns 403 for a disabled actorless admin account', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: ACTORLESS_EMAIL }
      })
      await database.setAccountDisabled({
        accountId: actorlessAccountId,
        disabled: true
      })

      try {
        const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
        expect(handle).not.toHaveBeenCalled()
      } finally {
        await database.setAccountDisabled({
          accountId: actorlessAccountId,
          disabled: false
        })
      }
    })

    it('returns 403 for an unconfirmed actorless admin account', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: ACTORLESS_EMAIL }
      })
      await instance('accounts').where('id', actorlessAccountId).update({
        verificationCode: 'actorless-unconfirmed-code',
        emailVerified: false
      })

      try {
        const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
        expect(handle).not.toHaveBeenCalled()
      } finally {
        await instance('accounts').where('id', actorlessAccountId).update({
          verificationCode: null,
          emailVerified: true
        })
      }
    })
  })

  describe('without database', () => {
    it('returns 500 when database is unavailable', async () => {
      const originalDb = mockDatabase
      mockDatabase = null
      try {
        const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toEqual({
          error: 'Database unavailable'
        })
        expect(handle).not.toHaveBeenCalled()
      } finally {
        mockDatabase = originalDb
      }
    })
  })

  describe('bearer token handling', () => {
    it('allows an admin OAuth bearer token for read routes', async () => {
      mockOAuthActor = {
        id: 'https://llun.test/users/admin',
        account: { id: 'oauth-admin-account-id', role: 'admin' }
      } as Actor

      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const response = await guard(
        new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
          headers: { Authorization: 'Bearer token' }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handle).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.objectContaining({
          moderator: {
            accountId: 'oauth-admin-account-id',
            actorId: 'https://llun.test/users/admin'
          }
        })
      )
      // Without a resource option, admin GET accepts the aggregate admin:read
      // scope only — no coarse read and no granular admin:read:* scope.
      expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
        [Scope.enum['admin:read']],
        expect.any(Function),
        expect.objectContaining({
          errorResponse: expect.any(Function)
        })
      )
    })

    it('adds the resource granular admin:read scope for a read route', async () => {
      const guard = AdminApiGuard([HttpMethod.enum.GET], handle, {
        resource: 'domain_blocks'
      })
      await guard(
        new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
          headers: { Authorization: 'Bearer token' }
        }),
        { params: Promise.resolve({}) }
      )

      // The domain_blocks route additionally accepts its own granular
      // admin:read:domain_blocks scope, without widening any other admin route.
      expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
        [Scope.enum['admin:read'], Scope.enum['admin:read:domain_blocks']],
        expect.any(Function),
        expect.objectContaining({
          errorResponse: expect.any(Function)
        })
      )
    })

    it('adds the resource granular admin:write scope for a non-GET route', async () => {
      const guard = AdminApiGuard([HttpMethod.enum.POST], handle, {
        resource: 'domain_allows'
      })
      await guard(
        new NextRequest('https://llun.test/api/v1/admin/domain_allows', {
          method: 'POST',
          headers: { Authorization: 'Bearer token' }
        }),
        { params: Promise.resolve({}) }
      )

      expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
        [Scope.enum['admin:write'], Scope.enum['admin:write:domain_allows']],
        expect.any(Function),
        expect.objectContaining({
          errorResponse: expect.any(Function)
        })
      )
    })

    it('requires write scope for non-GET admin routes', async () => {
      const guard = AdminApiGuard([HttpMethod.enum.POST], handle)
      await guard(
        new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
          method: 'POST',
          headers: { Authorization: 'Bearer token' }
        }),
        { params: Promise.resolve({}) }
      )

      // Admin POST accepts the aggregate admin:write scope only.
      expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
        [Scope.enum['admin:write']],
        expect.any(Function),
        expect.objectContaining({
          errorResponse: expect.any(Function)
        })
      )
    })

    // An admin who authorized a third-party app for ordinary API use granted it
    // read / write, never an admin scope. Mastodon never lets read imply
    // admin:read, so that token must not reach admin data or moderation.
    it.each([
      { method: HttpMethod.enum.GET, resource: undefined },
      { method: HttpMethod.enum.GET, resource: 'accounts' as const },
      { method: HttpMethod.enum.GET, resource: 'reports' as const },
      { method: HttpMethod.enum.POST, resource: undefined },
      { method: HttpMethod.enum.POST, resource: 'accounts' as const },
      { method: HttpMethod.enum.POST, resource: 'reports' as const }
    ])(
      'refuses an admin token granted only coarse read/write ($method, $resource)',
      async ({ method, resource }) => {
        mockGrantedScopes = ['read', 'write', 'follow', 'push']
        const guard = AdminApiGuard([method], handle, { resource })
        const response = await guard(
          new NextRequest('https://llun.test/api/v1/admin/accounts', {
            method,
            headers: { Authorization: 'Bearer token' }
          }),
          { params: Promise.resolve({}) }
        )

        expect(response.status).toBe(401)
        expect(handle).not.toHaveBeenCalled()
      }
    )

    it('admits an admin token granted the route resource granular scope', async () => {
      mockGrantedScopes = ['admin:read:reports']
      const guard = AdminApiGuard([HttpMethod.enum.GET], handle, {
        resource: 'reports'
      })
      const response = await guard(
        new NextRequest('https://llun.test/api/v1/admin/reports', {
          headers: { Authorization: 'Bearer token' }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handle).toHaveBeenCalled()
    })

    // The mock above only mirrors the guard. These drive the real
    // OAuthGuardAnyScope, so the refusal status is the one production sends.
    describe('through the real OAuthGuardAnyScope', () => {
      // The token resolves to the seeded admin actor, so a scope-check bypass
      // would run the handler and answer 200 instead of the 401 asserted below
      // (without a resolvable actor the guard 401s on no_actor_for_token even
      // when the scope check is skipped).
      const storeToken = (scopes: string) => {
        mockStoredToken = {
          userId: 'user-id',
          referenceId: adminActor.id,
          scopes,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        }
      }

      const call = (method: HttpMethod) =>
        AdminApiGuard([method], handle)(
          new NextRequest('https://llun.test/api/v1/admin/accounts', {
            method,
            headers: { Authorization: 'Bearer opaque-token' }
          }),
          { params: Promise.resolve({}) }
        )

      let debugSpy: ReturnType<typeof vi.spyOn>

      beforeEach(async () => {
        const actual =
          await vi.importActual<typeof import('./OAuthGuard')>('./OAuthGuard')
        mockOAuthGuardAnyScope.mockImplementation(actual.OAuthGuardAnyScope)
        debugSpy = vi.spyOn(oauthLogger, 'debug')
      })

      afterEach(() => {
        mockStoredToken = null
        debugSpy.mockRestore()
      })

      it.each([
        { method: HttpMethod.enum.GET },
        { method: HttpMethod.enum.POST }
      ])(
        'answers 401 insufficient_scope to a coarse read/write token ($method)',
        async ({ method }) => {
          storeToken('read write follow push')

          const response = await call(method)

          expect(response.status).toBe(401)
          expect(handle).not.toHaveBeenCalled()
          expect(debugSpy).toHaveBeenCalledWith(
            expect.objectContaining({ reason: 'insufficient_scope' }),
            expect.any(String)
          )
        }
      )

      it.each([
        { method: HttpMethod.enum.GET, scopes: 'admin:read' },
        { method: HttpMethod.enum.POST, scopes: 'admin:write' }
      ])(
        'admits an $scopes token ($method), proving the refusals above come from the scope',
        async ({ method, scopes }) => {
          storeToken(scopes)

          const response = await call(method)

          expect(response.status).toBe(200)
          expect(handle).toHaveBeenCalledTimes(1)
        }
      )
    })

    it('rejects a non-admin OAuth bearer token', async () => {
      mockOAuthActor = {
        account: { role: 'user' }
      } as Actor

      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const response = await guard(
        new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
          headers: { Authorization: 'Bearer token' }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(403)
    })

    it('rejects requests without session or bearer token', async () => {
      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const response = await guard(
        new NextRequest('https://llun.test/api/v1/admin/domain_blocks'),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(403)
      expect(mockOAuthGuardAnyScope).not.toHaveBeenCalled()
    })
  })
})
