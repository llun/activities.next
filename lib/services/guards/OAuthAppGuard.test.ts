import { NextResponse } from 'next/server'

import {
  getTestSQLDatabase,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'

import { OAuthAppGuard } from './OAuthGuard'
import { createRequest, hashToken, mockHandler } from './OAuthGuard.testUtils'

// Mock auth session
const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

// Mock database getter
let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
// mockStoredTokens maps hashed tokens to their stored records
const mockStoredTokens = new Map<string, Record<string, unknown>>()
const mockKnexQueryBuilder = (hashedToken: string) => ({
  first: () => Promise.resolve(mockStoredTokens.get(hashedToken) ?? null)
})
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => (_table: string) => ({
    where: (_field: string, value: string) => mockKnexQueryBuilder(value)
  })
}))

// Mock cookies from next/headers — controls which actor the cookie selects
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
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'secret phases',
    trustedHosts: ['trusted.llun.test']
  }),
  getBaseURL: () => 'https://llun.test'
}))

// Mock verifyBearerToken from better-auth
const mockVerifyBearerToken = vi.fn()
vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: (...args: unknown[]) => mockVerifyBearerToken(...args)
}))

describe('OAuthGuard', () => {
  const { database } = getTestSQLDatabaseWithInstance()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    mockGetServerSession.mockReset()
    mockVerifyBearerToken.mockReset()
    mockCookieValue.value = undefined
    mockStoredTokens.clear()
    mockHandler.mockClear()
  })

  describe('OAuthAppGuard', () => {
    // Client resolution goes through the real mockDatabase (getClientFromId),
    // which has no client rows seeded here — so these unit tests assert auth
    // outcomes + currentActor, and leave client-detail assertions to the
    // verify_credentials route test.
    type CapturedContext = {
      currentActor: Actor | null
      grantedScopes: string[]
    }

    const captureHandler = () => {
      let captured: CapturedContext | undefined
      const handler = vi.fn().mockImplementation((_req, context) => {
        captured = {
          currentActor: context.currentActor,
          grantedScopes: context.grantedScopes
        }
        return NextResponse.json({ success: true }, { status: 200 })
      })
      return { handler, getCaptured: () => captured }
    }

    test('accepts an app token with no actor (null referenceId)', async () => {
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('app-token-no-actor'), {
        token: hashToken('app-token-no-actor'),
        referenceId: null,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const { handler, getCaptured } = captureHandler()
      const guard = OAuthAppGuard([Scope.enum.read], handler, {
        matchMode: 'any'
      })
      const req = createRequest({ Authorization: 'Bearer app-token-no-actor' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
      expect(getCaptured()?.currentActor).toBeNull()
      expect(getCaptured()?.grantedScopes).toEqual(['read'])
    })

    test('accepts a JWT app token with no actorId claim (inverse of OAuthGuard)', async () => {
      // OAuthGuard 401s a JWT with no actorId claim; OAuthAppGuard accepts it
      // as an actor-less app token. JWT access tokens are issued when a client
      // requests a `resource`, so this divergent contract must hold.
      mockGetServerSession.mockResolvedValue(null)
      const token = 'eyJ.app.sig'
      mockVerifyBearerToken.mockResolvedValue({ scope: 'read' })
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: null,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const { handler, getCaptured } = captureHandler()
      const guard = OAuthAppGuard([Scope.enum.read], handler, {
        matchMode: 'any'
      })
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
      expect(mockVerifyBearerToken).toHaveBeenCalled()
      expect(getCaptured()?.currentActor).toBeNull()
    })

    test('resolves the actor for a user token', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('user-token-app-guard'), {
        token: hashToken('user-token-app-guard'),
        referenceId: primaryActor?.id,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const { handler, getCaptured } = captureHandler()
      const guard = OAuthAppGuard([Scope.enum.read], handler, {
        matchMode: 'any'
      })
      const req = createRequest({
        Authorization: 'Bearer user-token-app-guard'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(getCaptured()?.currentActor?.id).toBe(primaryActor?.id)
    })

    test('returns 403 for a user token whose actor is suspended', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('app-suspended-token'), {
        token: hashToken('app-suspended-token'),
        referenceId: primaryActor?.id,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })
      await database.setActorSuspended({
        actorId: primaryActor!.id,
        suspended: true
      })

      try {
        const { handler } = captureHandler()
        const guard = OAuthAppGuard([Scope.enum.read], handler, {
          matchMode: 'any'
        })
        const req = createRequest({
          Authorization: 'Bearer app-suspended-token'
        })
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        expect(handler).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: primaryActor!.id,
          suspended: false
        })
      }
    })

    test('returns 401 for an expired app token', async () => {
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('expired-app-token'), {
        token: hashToken('expired-app-token'),
        referenceId: null,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() - 1000),
        scopes: JSON.stringify(['read'])
      })

      const { handler } = captureHandler()
      const guard = OAuthAppGuard([Scope.enum.read], handler, {
        matchMode: 'any'
      })
      const req = createRequest({ Authorization: 'Bearer expired-app-token' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    test('returns 401 for a revoked/unknown token (not in store)', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const { handler } = captureHandler()
      const guard = OAuthAppGuard([Scope.enum.read], handler, {
        matchMode: 'any'
      })
      const req = createRequest({ Authorization: 'Bearer unknown-app-token' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    test('returns 401 when a delegated actor no longer exists (fail-safe)', async () => {
      // A user token that references a deleted actor must not silently
      // downgrade to an actor-less context — it fails closed with 401.
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('deleted-actor-token'), {
        token: hashToken('deleted-actor-token'),
        referenceId: 'https://llun.test/users/deleted',
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const { handler } = captureHandler()
      const guard = OAuthAppGuard([Scope.enum.read], handler, {
        matchMode: 'any'
      })
      const req = createRequest({
        Authorization: 'Bearer deleted-actor-token'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    test('returns 401 (not 500) when the stored token has null scopes', async () => {
      // A corrupt/null scopes column must fail the scope check gracefully
      // rather than throwing in parseStoredScopes and surfacing a 500.
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('null-scopes-token'), {
        token: hashToken('null-scopes-token'),
        referenceId: null,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: null
      })

      const { handler } = captureHandler()
      const guard = OAuthAppGuard([Scope.enum.read], handler, {
        matchMode: 'any'
      })
      const req = createRequest({ Authorization: 'Bearer null-scopes-token' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    test('returns 401 when the token lacks the required scope', async () => {
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('read-only-app-token'), {
        token: hashToken('read-only-app-token'),
        referenceId: null,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const { handler } = captureHandler()
      const guard = OAuthAppGuard([Scope.enum.write], handler)
      const req = createRequest({ Authorization: 'Bearer read-only-app-token' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    test('returns 401 without a bearer token and never falls back to a session', async () => {
      // Even with a valid cookie session present, OAuthAppGuard is bearer-only.
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const { handler } = captureHandler()
      const guard = OAuthAppGuard([Scope.enum.read], handler, {
        matchMode: 'any'
      })
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
      expect(mockGetServerSession).not.toHaveBeenCalled()
    })
  })
})
