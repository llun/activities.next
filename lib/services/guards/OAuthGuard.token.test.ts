import { NextRequest, NextResponse } from 'next/server'

import {
  getTestSQLDatabase,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import {
  OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  OAUTH_ACCESS_TOKEN_SLIDE_INTERVAL_SECONDS
} from '@/lib/services/auth/constants'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'
import { logger } from '@/lib/utils/logger'

import {
  OAuthAppGuard,
  OAuthGuard,
  OAuthGuardAnyScope,
  OptionalOAuthGuard
} from './OAuthGuard'
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

    // Most Mastodon routes use OAuthGuardAnyScope (aggregate OR granular scope)
    // and routeScopeWiring.test.ts leans on this file for what it does with a
    // wrong or missing token, so its rejections are pinned here, not per route.
    test('any-scope guard returns 401 when no auth header provided and no session', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const guard = OAuthGuardAnyScope(
        [Scope.enum.read, Scope.enum['read:bookmarks']],
        mockHandler
      )
      const response = await guard(createRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('any-scope guard returns 401 when an opaque token holds none of the listed scopes', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockStoredTokens.set(hashToken('unrelated-scope-opaque'), {
        token: hashToken('unrelated-scope-opaque'),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read:statuses'])
      })

      const guard = OAuthGuardAnyScope(
        [Scope.enum.read, Scope.enum['read:bookmarks']],
        mockHandler
      )
      const req = createRequest({
        Authorization: 'Bearer unrelated-scope-opaque'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    test('any-scope guard returns 401 when a JWT holds none of the listed scopes', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const token = 'eyJ.unrelated-scope.sig'

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      mockVerifyBearerToken.mockResolvedValue({
        sub: 'user-id',
        scope: 'read:statuses',
        actorId: primaryActor?.id
      })
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read:statuses'])
      })

      const guard = OAuthGuardAnyScope(
        [Scope.enum.read, Scope.enum['read:bookmarks']],
        mockHandler
      )
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    // Scope rules live in scopeHierarchy.test.ts; these rows only prove the
    // guard feeds the token's scopes and the route's requirement through them.
    test.each([
      {
        description: 'parent read scope satisfies read:conversations',
        granted: ['read'],
        required: Scope.enum['read:conversations'],
        status: 200
      },
      {
        description: 'parent read scope satisfies read:statuses',
        granted: ['read'],
        required: Scope.enum['read:statuses'],
        status: 200
      },
      {
        description: 'parent write scope satisfies write:accounts',
        granted: ['write'],
        required: Scope.enum['write:accounts'],
        status: 200
      },
      {
        description:
          'sibling status-write scope is rejected for account writes',
        granted: ['write:statuses'],
        required: Scope.enum['write:accounts'],
        status: 401
      },
      {
        description: 'sibling conversation scope is rejected for status reads',
        granted: ['read:conversations'],
        required: Scope.enum['read:statuses'],
        status: 401
      },
      // Granular-only tokens do not satisfy a coarse scope requirement. Allowing
      // the reverse direction would over-grant: a write:media token would satisfy
      // any route guarded with write, bypassing the consent the user gave.
      // Routes that need to serve granular-only clients must explicitly include
      // the granular scope in their guard (e.g. OAuthGuardAnyScope([read, read:conversations])).
      {
        description:
          'a granular-only token is rejected when the route requires a coarse scope',
        granted: ['read:conversations'],
        required: Scope.enum.read,
        status: 401
      }
    ])('scope wiring: $description', async ({ granted, required, status }) => {
      mockGetServerSession.mockResolvedValue(null)

      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      const token = `scope-wiring-${granted.join('-')}-${required}`
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: primaryActor?.id,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(granted)
      })

      const guard = OAuthGuard([required], mockHandler)
      const req = createRequest({ Authorization: `Bearer ${token}` })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(status)
      if (status === 200) {
        expect(mockHandler).toHaveBeenCalled()
      } else {
        expect(mockHandler).not.toHaveBeenCalled()
      }
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

  describe('sliding opaque token expiry', () => {
    const NOW = Date.UTC(2026, 9, 3, 12, 0, 0)
    const HOUR_MS = 60 * 60 * 1000
    const WINDOW_MS = OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000
    const INTERVAL_MS = OAUTH_ACCESS_TOKEN_SLIDE_INTERVAL_SECONDS * 1000

    let extendSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      // Only `Date` is faked: the SQLite driver relies on real timers.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
      mockGetServerSession.mockResolvedValue(null)
      extendSpy = vi.spyOn(database, 'extendOAuthAccessToken')
    })

    afterEach(() => {
      extendSpy.mockRestore()
      vi.useRealTimers()
    })

    const storeToken = async (
      token: string,
      fields: Record<string, unknown>
    ) => {
      const primaryActor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      if (!primaryActor?.account) throw new Error('Primary actor not found')
      mockStoredTokens.set(hashToken(token), {
        token: hashToken(token),
        referenceId: primaryActor.id,
        userId: primaryActor.account.id,
        scopes: JSON.stringify(['read']),
        ...fields
      })
      return primaryActor
    }

    const callWith = (token: string, scopes: Scope[] = [Scope.enum.read]) =>
      OAuthGuard(scopes, mockHandler)(
        createRequest({ Authorization: `Bearer ${token}` }),
        { params: Promise.resolve({}) }
      )

    // `expiresAt` is issue (or last slide) time + WINDOW_MS, so a token last
    // touched `age` ago has `NOW - age + WINDOW_MS`.
    const expiringAfterAge = (age: number) => new Date(NOW - age + WINDOW_MS)

    test.each([
      {
        description: 'exactly one slide interval after it was issued',
        expiresAt: expiringAfterAge(INTERVAL_MS)
      },
      {
        description: 'in its last hour, the case that used to sign clients out',
        expiresAt: new Date(NOW + HOUR_MS)
      },
      {
        description:
          'that better-auth soft-revoked when its web session ended, as Mastodon keeps apps signed in across a web sign-out',
        expiresAt: new Date(NOW + HOUR_MS),
        revoked: new Date(NOW - HOUR_MS)
      }
    ])('slides a token used $description', async ({ expiresAt, revoked }) => {
      await storeToken('due-token', { expiresAt, revoked })

      const response = await callWith('due-token')

      expect(response.status).toBe(200)
      expect(extendSpy).toHaveBeenCalledWith({
        hashedToken: hashToken('due-token'),
        expiresAt: NOW + WINDOW_MS
      })
    })

    test.each([
      {
        description: 'a token used one millisecond short of a slide interval',
        fields: { expiresAt: expiringAfterAge(INTERVAL_MS - 1) },
        scopes: [Scope.enum.read],
        status: 200
      },
      {
        description: 'an app (client_credentials) token, which has no user',
        fields: { userId: null, expiresAt: new Date(NOW + 30 * 60 * 1000) },
        scopes: [Scope.enum.read],
        status: 200
      },
      {
        description: 'an expired token',
        fields: { expiresAt: new Date(NOW - 1000) },
        scopes: [Scope.enum.read],
        status: 401
      },
      {
        description: 'a token presented without the scope the route needs',
        fields: { expiresAt: new Date(NOW + HOUR_MS) },
        scopes: [Scope.enum.write],
        status: 401
      },
      {
        description: 'a token whose actor no longer exists',
        fields: {
          referenceId: 'https://llun.test/users/deleted',
          expiresAt: new Date(NOW + HOUR_MS)
        },
        scopes: [Scope.enum.read],
        status: 401
      }
    ])('does not slide $description', async ({ fields, scopes, status }) => {
      await storeToken('not-due-token', fields)

      const response = await callWith('not-due-token', scopes)

      expect(response.status).toBe(status)
      expect(extendSpy).not.toHaveBeenCalled()
    })

    describe('an account awaiting confirmation', () => {
      const PENDING_USERNAME = 'pendingslide'
      const PENDING_ACTOR_ID = `https://llun.test/users/${PENDING_USERNAME}`
      let pendingAccountId: string

      beforeAll(async () => {
        pendingAccountId = await database.createAccount({
          domain: 'llun.test',
          email: 'pending-slide@llun.test',
          username: PENDING_USERNAME,
          passwordHash: 'pending-password-hash',
          privateKey: 'pending-private-key',
          publicKey: 'pending-public-key',
          verificationCode: 'pending-confirmation-code'
        })
      })

      const storePendingToken = (token: string) =>
        storeToken(token, {
          referenceId: PENDING_ACTOR_ID,
          userId: pendingAccountId,
          expiresAt: new Date(NOW + HOUR_MS)
        })

      test('is refused by OAuthGuard without sliding its token', async () => {
        await storePendingToken('pending-guard-token')

        const response = await callWith('pending-guard-token')

        expect(response.status).toBe(403)
        expect(extendSpy).not.toHaveBeenCalled()
      })

      test('is served anonymously by OptionalOAuthGuard without sliding its token', async () => {
        await storePendingToken('pending-optional-token')
        const handler = vi
          .fn()
          .mockImplementation((_req, context) =>
            NextResponse.json(
              { actor: context.currentActor?.id ?? null },
              { status: 200 }
            )
          )

        const response = await OptionalOAuthGuard([Scope.enum.read], handler)(
          createRequest({ Authorization: 'Bearer pending-optional-token' }),
          { params: Promise.resolve({}) }
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ actor: null })
        expect(extendSpy).not.toHaveBeenCalled()
      })

      test('is refused by OAuthAppGuard without sliding its token', async () => {
        await storePendingToken('pending-app-guard-token')

        const response = await OAuthAppGuard([Scope.enum.read], mockHandler)(
          createRequest({ Authorization: 'Bearer pending-app-guard-token' }),
          { params: Promise.resolve({}) }
        )

        expect(response.status).toBe(403)
        expect(extendSpy).not.toHaveBeenCalled()
      })
    })

    test('slides a due token accepted by OptionalOAuthGuard', async () => {
      await storeToken('optional-guard-token', {
        expiresAt: new Date(NOW + HOUR_MS)
      })

      const response = await OptionalOAuthGuard([Scope.enum.read], mockHandler)(
        createRequest({ Authorization: 'Bearer optional-guard-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(extendSpy).toHaveBeenCalledWith({
        hashedToken: hashToken('optional-guard-token'),
        expiresAt: NOW + WINDOW_MS
      })
    })

    test('does not slide the token of a suspended actor polling OAuthAppGuard', async () => {
      const actor = await storeToken('suspended-app-guard-token', {
        expiresAt: new Date(NOW + HOUR_MS)
      })
      await database.setActorSuspended({ actorId: actor.id, suspended: true })

      try {
        const response = await OAuthAppGuard([Scope.enum.read], mockHandler)(
          createRequest({ Authorization: 'Bearer suspended-app-guard-token' }),
          { params: Promise.resolve({}) }
        )

        expect(response.status).toBe(403)
        expect(extendSpy).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: actor.id,
          suspended: false
        })
      }
    })

    test('does not slide the token of a suspended actor still polling', async () => {
      const actor = await storeToken('suspended-token', {
        expiresAt: new Date(NOW + HOUR_MS)
      })
      await database.setActorSuspended({ actorId: actor.id, suspended: true })

      try {
        const response = await callWith('suspended-token')

        expect(response.status).toBe(403)
        expect(extendSpy).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: actor.id,
          suspended: false
        })
      }
    })

    test('does not slide a JWT access token, whose exp is signed in', async () => {
      const actor = await storeToken('eyJ.due-jwt.sig', {
        expiresAt: new Date(NOW + HOUR_MS)
      })
      mockVerifyBearerToken.mockResolvedValue({
        sub: 'user-id',
        scope: 'read',
        actorId: actor.id
      })

      const response = await callWith('eyJ.due-jwt.sig')

      expect(response.status).toBe(200)
      expect(mockVerifyBearerToken).toHaveBeenCalled()
      expect(extendSpy).not.toHaveBeenCalled()
    })

    test('slides a user token accepted by OAuthAppGuard', async () => {
      await storeToken('app-guard-user-token', {
        expiresAt: new Date(NOW + HOUR_MS)
      })

      const response = await OAuthAppGuard([Scope.enum.read], mockHandler)(
        createRequest({ Authorization: 'Bearer app-guard-user-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(extendSpy).toHaveBeenCalledWith({
        hashedToken: hashToken('app-guard-user-token'),
        expiresAt: NOW + WINDOW_MS
      })
    })

    test('still authenticates the request and logs when the slide fails to write', async () => {
      const failure = new Error('database is locked')
      extendSpy.mockRejectedValueOnce(failure)
      const warnSpy = vi.spyOn(logger, 'warn')
      await storeToken('write-fails-token', {
        expiresAt: new Date(NOW + HOUR_MS)
      })

      try {
        const response = await callWith('write-fails-token')

        expect(response.status).toBe(200)
        expect(mockHandler).toHaveBeenCalled()
        expect(warnSpy).toHaveBeenCalledWith({
          message: 'Failed to extend OAuth access token expiry',
          err: failure
        })
      } finally {
        warnSpy.mockRestore()
      }
    })
  })
})
