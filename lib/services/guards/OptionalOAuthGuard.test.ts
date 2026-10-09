import {
  getTestSQLDatabase,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { Scope } from '@/lib/types/database/operations'

import { OptionalOAuthGuard } from './OAuthGuard'
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

    test('downgrades an unconfirmed cookie session too, not just a bearer token', async () => {
      // The disposition is applied on BOTH halves of
      // `resolveAuthenticatedContext`, and removing it from the session half
      // alone left every other test in this file passing. These routes are
      // reached from the website's own cookie session, and an account can hold
      // a working session while still pending — see the pre-2026-03-20 cohort.
      mockGetServerSession.mockResolvedValue({ user: { email: PENDING_EMAIL } })

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

    test('downgrades an expired bearer token to anonymous access (matching Mastodon)', async () => {
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('optional-expired-token'), {
        token: hashToken('optional-expired-token'),
        referenceId: PENDING_ACTOR_ID,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() - 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OptionalOAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(
        createRequest({ Authorization: 'Bearer optional-expired-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ currentActor: null })
      )
    })

    test('downgrades a non-existent bearer token to anonymous access (matching Mastodon)', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const guard = OptionalOAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(
        createRequest({ Authorization: 'Bearer nonexistent-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ currentActor: null })
      )
    })

    test('downgrades a malformed authorization header to anonymous access', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const guard = OptionalOAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(
        createRequest({ Authorization: 'NotBearer format' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ currentActor: null })
      )
    })

    test('downgrades a token with insufficient scope to anonymous access on OptionalOAuthGuard', async () => {
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('optional-write-only-token'), {
        token: hashToken('optional-write-only-token'),
        referenceId: PENDING_ACTOR_ID,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['write'])
      })

      const guard = OptionalOAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(
        createRequest({ Authorization: 'Bearer optional-write-only-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ currentActor: null })
      )
    })
  })
})
