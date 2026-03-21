import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'

import { OAuthGuard, getTokenFromHeader } from './OAuthGuard'

// Mock auth session
const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

// Mock database getter
let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
// mockStoredTokens maps hashed tokens to their stored records
const mockStoredTokens = new Map<string, Record<string, unknown>>()
const hashToken = (token: string) =>
  crypto
    .createHash('sha256')
    .update(token)
    .digest()
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const mockKnexQueryBuilder = (hashedToken: string) => ({
  first: () => Promise.resolve(mockStoredTokens.get(hashedToken) ?? null)
})
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => (_table: string) => ({
    where: (_field: string, value: string) => mockKnexQueryBuilder(value)
  })
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

// Mock config
jest.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'secret phases'
  }),
  getBaseURL: () => 'https://llun.test'
}))

// Mock verifyAccessToken from better-auth
const mockVerifyAccessToken = jest.fn()
jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args)
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
    mockVerifyAccessToken.mockReset()
    mockCookieValue.value = undefined
    mockStoredTokens.clear()
    mockHandler.mockClear()
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

  describe('bearer token authentication (JWT path)', () => {
    // JWT-format tokens (three dot-separated segments) trigger the JWT path
    const jwtToken = (name: string) => `eyJ.${name}.sig`

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

    test('allows request with valid JWT access token', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      const token = jwtToken('valid')

      mockVerifyAccessToken.mockResolvedValue({
        sub: 'user-id',
        scope: 'read',
        actorId: primaryActor?.id
      })
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
      expect(mockVerifyAccessToken).toHaveBeenCalledWith(token, {
        jwksUrl: 'https://llun.test/api/auth/jwks',
        scopes: [Scope.enum.read],
        verifyOptions: {
          issuer: 'https://llun.test',
          audience: 'https://llun.test'
        }
      })
    })

    test('returns 401 when JWT has no actorId claim', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = jwtToken('no-actor')

      mockVerifyAccessToken.mockResolvedValue({
        sub: 'user-id',
        scope: 'read'
        // no actorId
      })
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: null,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
    })

    test('returns 401 when actorId refers to non-existent actor', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = jwtToken('bad-actor')

      mockVerifyAccessToken.mockResolvedValue({
        sub: 'user-id',
        scope: 'read',
        actorId: 'non-existent-actor-id'
      })
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: 'non-existent-actor-id',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
    })

    test('returns 401 when JWT has been revoked (not in DB)', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = jwtToken('revoked')

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockVerifyAccessToken.mockResolvedValue({
        sub: 'user-id',
        scope: 'read',
        actorId: primaryActor?.id
      })
      // Token not in store — simulates revocation

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
    })

    test('returns 401 when JWT is expired — does not fall through to opaque', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = jwtToken('expired')

      mockVerifyAccessToken.mockRejectedValue(new Error('token expired'))
      // Even with a valid DB row, expired JWT rejects immediately
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: 'some-actor-id',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('returns 401 when JWT has invalid signature — does not fall through to opaque', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = jwtToken('tampered')

      mockVerifyAccessToken.mockRejectedValue(new Error('token invalid'))
      // Even with a matching DB row, tampered JWT rejects immediately
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('returns 401 when JWT scope does not match required scope', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = jwtToken('read-only')

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      // verifyAccessToken returns a read-only JWT payload
      mockVerifyAccessToken.mockResolvedValue({
        sub: 'user-id',
        scope: 'read',
        actorId: primaryActor?.id
      })
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      // Guard requires write scope
      const guard = OAuthGuard([Scope.enum.write], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })
  })

  describe('opaque token authentication', () => {
    // Opaque tokens have no dots — they skip JWT verification entirely
    test('allows request with valid opaque token', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('opaque-token'), {
        token: hashToken('opaque-token'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: 'Bearer opaque-token' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
      expect(mockVerifyAccessToken).not.toHaveBeenCalled()
    })

    test('returns 401 when opaque token is expired', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('expired-opaque'), {
        token: hashToken('expired-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() - 1000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: 'Bearer expired-opaque' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
    })

    test('returns 401 when opaque token lacks required scope', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('read-only-opaque'), {
        token: hashToken('read-only-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.write], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer read-only-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
    })

    test('returns 401 when opaque token has no referenceId', async () => {
      mockGetServerSession.mockResolvedValue(null)

      mockStoredTokens.set(hashToken('no-ref-opaque'), {
        token: hashToken('no-ref-opaque'),
        referenceId: null,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer no-ref-opaque'
      })
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
