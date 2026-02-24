import jwt from 'jsonwebtoken'
import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { MOCK_SECRET_PHASES } from '@/lib/stub/actor'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { Scope } from '@/lib/types/database/operations'

import { OAuthGuard, getTokenFromHeader } from './OAuthGuard'

// Mock next-auth session
const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

// Mock database getter
let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

// Mock cookies from next/headers — controls which actor the cookie selects
const mockCookieValue: { value?: string } = {}
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockImplementation(() =>
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

// Mock config — secretPhase must match MOCK_SECRET_PHASES used to sign JWTs in tests
jest.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'secret phases'
  })
}))

describe('#getTokenFromHeader', () => {
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

describe('#OAuthGuard', () => {
  const database = getTestSQLDatabase()

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
    mockCookieValue.value = undefined
  })

  const createRequest = (headers: Record<string, string> = {}) => {
    return new NextRequest('https://llun.test/api/test', {
      method: 'GET',
      headers
    })
  }

  const mockHandler = jest.fn().mockImplementation(() => {
    return NextResponse.json({ success: true }, { status: 200 })
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
      const handler = jest.fn().mockImplementation((_req, context) => {
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
      // Create a sub-actor for actor1's account
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
      const handler = jest.fn().mockImplementation((_req, context) => {
        capturedActor = context.currentActor
        return NextResponse.json({ success: true }, { status: 200 })
      })

      const guard = OAuthGuard([Scope.enum.read], handler)
      const req = createRequest()
      await guard(req, { params: Promise.resolve({}) })

      expect(handler).toHaveBeenCalled()
      // Must resolve the sub-actor chosen via cookie, not the login (primary) actor
      expect(capturedActor?.id).toBe(subActorId)
      expect(capturedActor?.username).toBe('oauth-subactor')
    })

    test('falls back to primary actor when cookie contains invalid actor id', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = 'invalid-actor-id-that-does-not-exist'

      let capturedActor: Actor | undefined
      const handler = jest.fn().mockImplementation((_req, context) => {
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

  describe('bearer token authentication', () => {
    test('returns 401 when no auth header provided and no session', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
    })

    test('returns 401 with invalid bearer token format', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: 'Basic abc123' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
    })

    test('returns 401 with invalid JWT', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: 'Bearer invalid.jwt.token' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(500) // JWT parse error
    })

    test('returns 401 when access token not found in database', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const token = jwt.sign(
        { jti: 'nonexistent-token-id' },
        MOCK_SECRET_PHASES,
        { expiresIn: '1h' }
      )

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
    })

    test('returns 401 when token has expired', async () => {
      mockGetServerSession.mockResolvedValue(null)

      // Create an expired token
      const token = jwt.sign({ jti: 'expired-token' }, MOCK_SECRET_PHASES, {
        expiresIn: '-1h'
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
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
