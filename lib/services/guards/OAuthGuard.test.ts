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
  getTokenFromHeader
} from './OAuthGuard'

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
    secretPhase: 'secret phases',
    trustedHosts: ['trusted.llun.test']
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

    test('ignores non-Bearer authorization when a valid session exists', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const req = createRequest({ Authorization: 'Basic upstream-token' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
      expect(mockVerifyAccessToken).not.toHaveBeenCalled()
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

    test('uses the provided errorResponse for auth failures', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const errorResponse = jest
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
        scopes: [],
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

    test('returns 401 when Better Auth opaque token has account userId but no actor referenceId', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      if (!primaryActor?.account) throw new Error('Primary actor not found')

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

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
      expect(mockVerifyAccessToken).not.toHaveBeenCalled()
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

  describe('#OAuthAppGuard', () => {
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
      const handler = jest.fn().mockImplementation((_req, context) => {
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
      mockVerifyAccessToken.mockResolvedValue({ scope: 'read' })
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
      expect(mockVerifyAccessToken).toHaveBeenCalled()
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
