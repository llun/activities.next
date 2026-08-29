import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { HttpMethod } from '@/lib/utils/http-headers'

import { AdminApiGuard } from './AdminApiGuard'

// Mock auth session
const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

// Mock database getter
let mockDatabase:
  ReturnType<typeof getTestSQLDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
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
    mockGetServerSession.mockResolvedValue(null)
    mockOAuthGuardAnyScope.mockImplementation(
      (
        _scopes: Scope[],
        handle: (
          req: NextRequest,
          context: {
            currentActor: Actor
            database: typeof database
            params: Promise<{}>
          }
        ) => Promise<Response> | Response
      ) =>
        (req: NextRequest, context: { params: Promise<{}> }) =>
          handle(req, {
            currentActor: mockOAuthActor,
            database,
            params: context.params
          })
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

  describe('bearer token handling', () => {
    it('allows an admin OAuth bearer token for read routes', async () => {
      const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
      const response = await guard(
        new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
          headers: { Authorization: 'Bearer token' }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      // Without a resource option, admin GET accepts coarse read OR the aggregate
      // admin:read scope only — no granular admin:read:* scope is added.
      expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
        [Scope.enum.read, Scope.enum['admin:read']],
        expect.any(Function)
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
        [
          Scope.enum.read,
          Scope.enum['admin:read'],
          Scope.enum['admin:read:domain_blocks']
        ],
        expect.any(Function)
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
        [
          Scope.enum.write,
          Scope.enum['admin:write'],
          Scope.enum['admin:write:domain_allows']
        ],
        expect.any(Function)
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

      // Admin POST accepts coarse write OR the aggregate admin:write scope.
      expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
        [Scope.enum.write, Scope.enum['admin:write']],
        expect.any(Function)
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
