import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'

import {
  OAuthAppGuard,
  OAuthGuard,
  OAuthGuardAnyScope,
  OptionalOAuthGuard,
  getTokenFromHeader
} from './OAuthGuard'

// Mock auth session
const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
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
    mockVerifyBearerToken.mockReset()
    mockCookieValue.value = undefined
    mockStoredTokens.clear()
    mockHandler.mockClear()
  })

  const createRequest = (
    headers: Record<string, string> = {},
    method = 'GET',
    url = 'https://llun.test/api/test'
  ) => {
    return new NextRequest(url, {
      method,
      headers
    })
  }

  const mockHandler = vi.fn().mockImplementation(() => {
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

    test('uses the provided errorResponse for auth failures', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const errorResponse = vi
        .fn()
        .mockImplementation(
          (_req: NextRequest, status: number) =>
            new NextResponse(null, { status })
        )
      const guard = OAuthGuard([Scope.enum.read], mockHandler, {
        errorResponse
      })
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(errorResponse).toHaveBeenCalledWith(req, 401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('allows request with valid JWT access token', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      const token = jwtToken('valid')

      mockVerifyBearerToken.mockResolvedValue({
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
      expect(mockVerifyBearerToken).toHaveBeenCalledWith(token, {
        jwksUrl: 'https://llun.test/api/auth/jwks',
        verifyOptions: {
          issuer: 'https://llun.test',
          audience: 'https://llun.test'
        }
      })
    })

    test('returns 401 when JWT has no actorId claim', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = jwtToken('no-actor')

      mockVerifyBearerToken.mockResolvedValue({
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

    test('returns 401 when a token has neither an actor reference nor a user', async () => {
      mockGetServerSession.mockResolvedValue(null)

      mockStoredTokens.set(hashToken('opaque-app-token'), {
        token: hashToken('opaque-app-token'),
        referenceId: null,
        userId: null,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: 'Bearer opaque-app-token' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('returns 401 when actorId refers to non-existent actor', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = jwtToken('bad-actor')

      mockVerifyBearerToken.mockResolvedValue({
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
      mockVerifyBearerToken.mockResolvedValue({
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

      mockVerifyBearerToken.mockRejectedValue(new Error('token expired'))
      // Even with a valid DB row, expired JWT rejects immediately
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

    test('returns 401 when JWT has invalid signature — does not fall through to opaque', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = jwtToken('tampered')

      mockVerifyBearerToken.mockRejectedValue(new Error('token invalid'))
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
      // verifyBearerToken returns a read-only JWT payload
      mockVerifyBearerToken.mockResolvedValue({
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
      expect(mockVerifyBearerToken).not.toHaveBeenCalled()
    })

    test('acts as the account actor when an opaque token has a userId but no actor referenceId', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      if (!primaryActor?.account) throw new Error('Primary actor not found')

      // A grant that resolved no actor reference — an account that never picked
      // a default actor, consenting through a path that does not show the
      // consent screen — stores an empty referenceId. The token still belongs
      // to an account, so it acts as that account's actor rather than failing
      // closed on every bearer route including /oauth/userinfo.
      mockStoredTokens.set(hashToken('better-auth-opaque-token'), {
        token: hashToken('better-auth-opaque-token'),
        referenceId: '',
        userId: primaryActor.account.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer better-auth-opaque-token'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalledWith(
        req,
        expect.objectContaining({
          currentActor: expect.objectContaining({ id: primaryActor.id })
        })
      )
      expect(mockVerifyBearerToken).not.toHaveBeenCalled()
    })

    test('allows request with lowercase bearer opaque token', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('lowercase-opaque-token'), {
        token: hashToken('lowercase-opaque-token'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({
        Authorization: 'bearer lowercase-opaque-token'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
      expect(mockVerifyBearerToken).not.toHaveBeenCalled()
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

    test('returns 401 when no required scopes are configured', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('empty-required-scopes-opaque'), {
        token: hashToken('empty-required-scopes-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer empty-required-scopes-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('allows opaque token when any requested scope matches', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('bookmark-scope-opaque'), {
        token: hashToken('bookmark-scope-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read:bookmarks'])
      })

      const guard = OAuthGuardAnyScope(
        [Scope.enum.read, Scope.enum['read:bookmarks']],
        mockHandler
      )
      const req = createRequest({
        Authorization: 'Bearer bookmark-scope-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('allows parent read scope to satisfy read:conversations', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('read-parent-opaque'), {
        token: hashToken('read-parent-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum['read:conversations']], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer read-parent-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('allows parent read scope to satisfy read:statuses', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('read-parent-statuses-opaque'), {
        token: hashToken('read-parent-statuses-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum['read:statuses']], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer read-parent-statuses-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('allows parent write scope to satisfy write:accounts', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('write-parent-accounts-opaque'), {
        token: hashToken('write-parent-accounts-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['write'])
      })

      const guard = OAuthGuard([Scope.enum['write:accounts']], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer write-parent-accounts-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('rejects sibling status-write scope for account writes', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('status-write-child-opaque'), {
        token: hashToken('status-write-child-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['write:statuses'])
      })

      const guard = OAuthGuard([Scope.enum['write:accounts']], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer status-write-child-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('rejects sibling conversation scope for status reads', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('conversation-read-opaque'), {
        token: hashToken('conversation-read-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read:conversations'])
      })

      const guard = OAuthGuard([Scope.enum['read:statuses']], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer conversation-read-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('rejects a granular-only token when the route requires a coarse scope', async () => {
      // Granular-only tokens do not satisfy a coarse scope requirement. Allowing
      // the reverse direction would over-grant: a write:media token would satisfy
      // any route guarded with write, bypassing the consent the user gave.
      // Routes that need to serve granular-only clients must explicitly include
      // the granular scope in their guard (e.g. OAuthGuardAnyScope([read, read:conversations])).
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('read-conversations-child-opaque'), {
        token: hashToken('read-conversations-child-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read:conversations'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({
        Authorization: 'Bearer read-conversations-child-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
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

  describe('moderation state gating', () => {
    test('returns 403 for bearer tokens whose actor is suspended', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('suspended-actor-token'), {
        token: hashToken('suspended-actor-token'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })
      await database.setActorSuspended({
        actorId: primaryActor!.id,
        suspended: true
      })

      try {
        const guard = OAuthGuard([Scope.enum.read], mockHandler)
        const req = createRequest({
          Authorization: 'Bearer suspended-actor-token'
        })
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        expect(mockHandler).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: primaryActor!.id,
          suspended: false
        })
      }
    })

    test('returns 403 for cookie sessions whose actor is suspended', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      await database.setActorSuspended({
        actorId: primaryActor!.id,
        suspended: true
      })

      try {
        const guard = OAuthGuard([Scope.enum.read], mockHandler)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        expect(mockHandler).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: primaryActor!.id,
          suspended: false
        })
      }
    })

    test('returns 403 for cookie sessions whose account is disabled', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      await database.setAccountDisabled({
        accountId: primaryActor!.account!.id,
        disabled: true
      })

      try {
        const guard = OAuthGuard([Scope.enum.read], mockHandler)
        const req = createRequest()
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(403)
        expect(mockHandler).not.toHaveBeenCalled()
      } finally {
        await database.setAccountDisabled({
          accountId: primaryActor!.account!.id,
          disabled: false
        })
      }
    })

    test('keeps accepting tokens for silenced actors', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('silenced-actor-token'), {
        token: hashToken('silenced-actor-token'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })
      await database.setActorSilenced({
        actorId: primaryActor!.id,
        silenced: true
      })

      try {
        const guard = OAuthGuard([Scope.enum.read], mockHandler)
        const req = createRequest({
          Authorization: 'Bearer silenced-actor-token'
        })
        const response = await guard(req, { params: Promise.resolve({}) })

        expect(response.status).toBe(200)
        expect(mockHandler).toHaveBeenCalled()
      } finally {
        await database.setActorSilenced({
          actorId: primaryActor!.id,
          silenced: false
        })
      }
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

  describe('unconfirmed account gating', () => {
    // Mastodon's `require_user!` answers 403 for a login whose e-mail is still
    // unconfirmed, before any API call runs. Registration through
    // `POST /api/v1/accounts` hands out a real user token immediately, so
    // without this the token is fully usable without controlling the address.
    const PENDING_EMAIL = 'pending-confirmation@llun.test'
    const PENDING_USERNAME = 'pendingconfirm'
    const PENDING_ACTOR_ID = `https://llun.test/users/${PENDING_USERNAME}`

    beforeAll(async () => {
      await database.createAccount({
        domain: 'llun.test',
        email: PENDING_EMAIL,
        username: PENDING_USERNAME,
        passwordHash: 'pending-password-hash',
        privateKey: 'pending-private-key',
        publicKey: 'pending-public-key',
        verificationCode: 'pending-confirmation-code'
      })
    })

    const storePendingToken = (token: string) => {
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: PENDING_ACTOR_ID,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read', 'write'])
      })
    }

    test('returns 403 for a bearer token whose account is awaiting confirmation', async () => {
      mockGetServerSession.mockResolvedValue(null)
      storePendingToken('unconfirmed-bearer-token')

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(
        createRequest({ Authorization: 'Bearer unconfirmed-bearer-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('returns 403 for a cookie session whose account is awaiting confirmation', async () => {
      mockGetServerSession.mockResolvedValue({ user: { email: PENDING_EMAIL } })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(createRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('returns 403 through OAuthAppGuard for a delegated unconfirmed actor', async () => {
      mockGetServerSession.mockResolvedValue(null)
      storePendingToken('unconfirmed-app-guard-token')

      const guard = OAuthAppGuard([Scope.enum.read], mockHandler, {
        matchMode: 'any'
      })
      const response = await guard(
        createRequest({ Authorization: 'Bearer unconfirmed-app-guard-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('allowUnconfirmedAccount lets the confirmation-resend endpoint through', async () => {
      // The one carve-out Mastodon makes too
      // (`Api::V1::Emails::ConfirmationsController` never calls
      // `require_user!`): resending its own confirmation e-mail is the single
      // thing an unconfirmed account must still be able to do, so blocking it
      // everywhere would make the state unrecoverable.
      mockGetServerSession.mockResolvedValue(null)
      storePendingToken('unconfirmed-resend-token')

      const guard = OAuthGuard([Scope.enum.read], mockHandler, {
        allowUnconfirmedAccount: true
      })
      const response = await guard(
        createRequest({ Authorization: 'Bearer unconfirmed-resend-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('allowUnconfirmedAccount does not relax the suspended-actor check', async () => {
      // The carve-out relaxes confirmation and nothing else: a suspended actor
      // stays refused on the very endpoint that is otherwise exempt.
      mockGetServerSession.mockResolvedValue(null)
      storePendingToken('unconfirmed-suspended-token')
      await database.setActorSuspended({
        actorId: PENDING_ACTOR_ID,
        suspended: true
      })

      try {
        const guard = OAuthGuard([Scope.enum.read], mockHandler, {
          allowUnconfirmedAccount: true
        })
        const response = await guard(
          createRequest({
            Authorization: 'Bearer unconfirmed-suspended-token'
          }),
          { params: Promise.resolve({}) }
        )

        expect(response.status).toBe(403)
        expect(mockHandler).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: PENDING_ACTOR_ID,
          suspended: false
        })
      }
    })

    test('leaves a confirmed account untouched', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const confirmedActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('confirmed-token'), {
        token: hashToken('confirmed-token'),
        referenceId: confirmedActor?.id,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(
        createRequest({ Authorization: 'Bearer confirmed-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })
  })

  describe('OptionalOAuthGuard and unconfirmed accounts', () => {
    // This guard fronts the public-facing reads — `timelines/public`,
    // `statuses/:id`, `accounts/:id/statuses`, search — where a token is
    // optional. It had NO test coverage at all before this block.
    const PENDING_EMAIL = 'optional-pending@llun.test'
    const PENDING_USERNAME = 'optionalpending'
    const PENDING_ACTOR_ID = `https://llun.test/users/${PENDING_USERNAME}`

    beforeAll(async () => {
      await database.createAccount({
        domain: 'llun.test',
        email: PENDING_EMAIL,
        username: PENDING_USERNAME,
        passwordHash: 'pending-password-hash',
        privateKey: 'pending-private-key',
        publicKey: 'pending-public-key',
        verificationCode: 'optional-pending-code'
      })
    })

    test('serves an unconfirmed account token as anonymous, not as itself', async () => {
      // Two failure modes bracket this, and asserting only the 200 catches
      // neither of them properly. Refusing made a valid token FAIL a read that
      // succeeds with no Authorization header. Accepting the actor would hand
      // an unverified account its identity — enough to read direct messages
      // addressed to it and to drive outbound federation through
      // `resolve=true`. So `currentActor` is asserted explicitly: a handler
      // that received the pending actor would still answer 200 here.
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('optional-unconfirmed-token'), {
        token: hashToken('optional-unconfirmed-token'),
        referenceId: PENDING_ACTOR_ID,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OptionalOAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(
        createRequest({ Authorization: 'Bearer optional-unconfirmed-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ currentActor: null })
      )
    })

    test('still refuses a suspended actor on the same guard', async () => {
      // The carve-out is confirmation-only. Suspension IS global in Mastodon,
      // and `isActorModerationBlocked` keeps running here.
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('optional-suspended-token'), {
        token: hashToken('optional-suspended-token'),
        referenceId: PENDING_ACTOR_ID,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })
      await database.setActorSuspended({
        actorId: PENDING_ACTOR_ID,
        suspended: true
      })

      try {
        const guard = OptionalOAuthGuard([Scope.enum.read], mockHandler)
        const response = await guard(
          createRequest({ Authorization: 'Bearer optional-suspended-token' }),
          { params: Promise.resolve({}) }
        )

        expect(response.status).toBe(403)
        expect(mockHandler).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: PENDING_ACTOR_ID,
          suspended: false
        })
      }
    })

    test('falls through to the anonymous path with no token', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const guard = OptionalOAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(createRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ currentActor: null })
      )
    })
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
