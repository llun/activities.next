import { NextResponse } from 'next/server'

import {
  getTestSQLDatabase,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'

import { OAuthGuard, getTokenFromHeader } from './OAuthGuard'
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

describe('getTokenFromHeader', () => {
  test('it returns token from header', () => {
    expect(getTokenFromHeader('Bearer token')).toEqual('token')
    expect(
      getTokenFromHeader(
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaWQiOiJmOGQwZDNjMC0yNWYzLTRmNTItYmIxMy1mODhhNzUxYjZjNTQiLCJzY29wZSI6InJlYWQgd3JpdGUiLCJzdWIiOiJodHRwczovL2NoYXQubGx1bi5pbi50aC91c2Vycy9tZSIsImV4cCI6MTcwODYzMzcwNywibmJmIjoxNzA4NjMwMTA3LCJpYXQiOjE3MDg2MzAxMDcsImp0aSI6IjY4MmEwOTc4NTVlNjY4MDhmZmQ0ZTlkNmIyMjg0OTE0YTlhZDk0MTQzYmNmMDkwNjQ2Y2VkZmI5Mzk2YmYwYzRlNzAzYTFlOWQ4NTQwZGMxIn0.btGNor-jWq55IL864txc73S8Dbwras8mE65KyoJDPSQ'
      )
    ).toEqual(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaWQiOiJmOGQwZDNjMC0yNWYzLTRmNTItYmIxMy1mODhhNzUxYjZjNTQiLCJzY29wZSI6InJlYWQgd3JpdGUiLCJzdWIiOiJodHRwczovL2NoYXQubGx1bi5pbi50aC91c2Vycy9tZSIsImV4cCI6MTcwODYzMzcwNywibmJmIjoxNzA4NjMwMTA3LCJpYXQiOjE3MDg2MzAxMDcsImp0aSI6IjY4MmEwOTc4NTVlNjY4MDhmZmQ0ZTlkNmIyMjg0OTE0YTlhZDk0MTQzYmNmMDkwNjQ2Y2VkZmI5Mzk2YmYwYzRlNzAzYTFlOWQ4NTQwZGMxIn0.btGNor-jWq55IL864txc73S8Dbwras8mE65KyoJDPSQ'
    )
  })

  test('it returns null if header is not a bearer token', () => {
    const token = getTokenFromHeader('Basic token')
    expect(token).toBeNull()
  })

  test('it returns null if header is empty', () => {
    const token = getTokenFromHeader('')
    expect(token).toBeNull()
  })

  test('it returns null if header is null', () => {
    const token = getTokenFromHeader(null)
    expect(token).toBeNull()
  })
})

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

  describe('session-based authentication', () => {
    test('allows request with valid session', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('ignores non-Bearer authorization when a valid session exists', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: 'Basic upstream-token' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
      expect(mockVerifyBearerToken).not.toHaveBeenCalled()
    })

    test('rejects a cookie-session mutation without same-origin proof', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = OAuthGuard([Scope.enum.write], mockHandler)
      const req = createRequest({}, 'POST')
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('allows a cookie-session mutation with a same-origin header', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = OAuthGuard([Scope.enum.write], mockHandler)
      const req = createRequest({ Origin: 'https://llun.test' }, 'POST')
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('allows a cookie-session mutation with an origin from trusted hosts', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = OAuthGuard([Scope.enum.write], mockHandler)
      const req = createRequest({ Origin: 'https://trusted.llun.test' }, 'POST')
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('rejects a cookie-session mutation when origin only matches the request URL', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = OAuthGuard([Scope.enum.write], mockHandler)
      const req = createRequest(
        { Origin: 'https://attacker.test' },
        'POST',
        'https://attacker.test/api/test'
      )
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('does not fall back to cookie session when a bearer token lacks the required scope', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('read-only-opaque-with-session'), {
        token: hashToken('read-only-opaque-with-session'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.write], mockHandler)
      const req = createRequest(
        {
          Authorization: 'bearer read-only-opaque-with-session',
          Origin: 'https://llun.test'
        },
        'POST'
      )
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('returns 401 when session email has no associated actor', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: 'nonexistent@example.com' }
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
    })

    test('resolves primary actor when no actor-id cookie is set', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = undefined

      let capturedActor: Actor | undefined
      const handler = vi.fn().mockImplementation((_req, context) => {
        capturedActor = context.currentActor
        return NextResponse.json({ success: true }, { status: 200 })
      })

      const guard = OAuthGuard([Scope.enum.read], handler)
      const req = createRequest()
      await guard(req, { params: Promise.resolve({}) })

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      expect(capturedActor?.id).toBe(primaryActor?.id)
    })

    test('resolves sub-actor when actor-id cookie is set to sub-actor', async () => {
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      if (!primaryActor) throw new Error('Primary actor not found')

      const subActorId = await database.createActorForAccount({
        accountId: primaryActor.account!.id,
        username: 'oauth-subactor',
        domain: 'llun.test',
        publicKey: 'subactor-public-key',
        privateKey: 'subactor-private-key'
      })

      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = subActorId

      let capturedActor: Actor | undefined
      const handler = vi.fn().mockImplementation((_req, context) => {
        capturedActor = context.currentActor
        return NextResponse.json({ success: true }, { status: 200 })
      })

      const guard = OAuthGuard([Scope.enum.read], handler)
      const req = createRequest()
      await guard(req, { params: Promise.resolve({}) })

      expect(handler).toHaveBeenCalled()
      expect(capturedActor?.id).toBe(subActorId)
      expect(capturedActor?.username).toBe('oauth-subactor')
    })

    test('falls back to primary actor when cookie contains invalid actor id', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = 'invalid-actor-id-that-does-not-exist'

      let capturedActor: Actor | undefined
      const handler = vi.fn().mockImplementation((_req, context) => {
        capturedActor = context.currentActor
        return NextResponse.json({ success: true }, { status: 200 })
      })

      const guard = OAuthGuard([Scope.enum.read], handler)
      const req = createRequest()
      await guard(req, { params: Promise.resolve({}) })

      expect(handler).toHaveBeenCalled()
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      expect(capturedActor?.id).toBe(primaryActor?.id)
    })
  })

  describe('database unavailable', () => {
    test('returns 500 when database is not available', async () => {
      const originalDb = mockDatabase
      mockDatabase = null

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(500)

      mockDatabase = originalDb
    })
  })
})
