import {
  getTestSQLDatabase,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'

import { OAuthAppGuard, OAuthGuard } from './OAuthGuard'
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
  // `instance` is needed to force the backfilled-cohort row shape, which
  // `createAccount` cannot produce.
  const { database, instance } = getTestSQLDatabaseWithInstance()

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

    test('unconfirmedAccount: "allow" lets a delegated unconfirmed actor through OAuthAppGuard', async () => {
      mockGetServerSession.mockResolvedValue(null)
      storePendingToken('unconfirmed-app-guard-allow-token')

      const guard = OAuthAppGuard([Scope.enum.read], mockHandler, {
        matchMode: 'any',
        unconfirmedAccount: 'allow'
      })
      const response = await guard(
        createRequest({
          Authorization: 'Bearer unconfirmed-app-guard-allow-token'
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('unconfirmedAccount: "allow" lets the confirmation-resend endpoint through', async () => {
      // The one carve-out Mastodon makes too
      // (`Api::V1::Emails::ConfirmationsController` never calls
      // `require_user!`): resending its own confirmation e-mail is the single
      // thing an unconfirmed account must still be able to do, so blocking it
      // everywhere would make the state unrecoverable.
      mockGetServerSession.mockResolvedValue(null)
      storePendingToken('unconfirmed-resend-token')

      const guard = OAuthGuard([Scope.enum.read], mockHandler, {
        unconfirmedAccount: 'allow'
      })
      const response = await guard(
        createRequest({ Authorization: 'Bearer unconfirmed-resend-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('unconfirmedAccount: "allow" lets an unconfirmed cookie session through', async () => {
      mockGetServerSession.mockResolvedValue({ user: { email: PENDING_EMAIL } })

      const guard = OAuthGuard([Scope.enum.read], mockHandler, {
        unconfirmedAccount: 'allow'
      })
      const response = await guard(createRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('unconfirmedAccount: "allow" does not relax the suspended-actor check', async () => {
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
          unconfirmedAccount: 'allow'
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

  describe('the 2026-03-20 backfilled cohort', () => {
    // The one shape the pure-unit predicate tests cannot reach: a row where
    // `verificationCode` is set AND `emailVerified` is true, driven all the way
    // through `getActorFromId` -> `Actor.parse` -> `isActorConfirmationPending`.
    // Without this, a regression in the DOMAIN-TYPE half of the fix — the Zod
    // field, or either row-to-domain mapper dropping `emailVerified` — would
    // ship with every predicate test still green, and would lock out accounts
    // that have been signing in for months with no way back.
    const COHORT_EMAIL = 'backfilled-cohort@llun.test'
    const COHORT_USERNAME = 'backfilledcohort'
    const COHORT_ACTOR_ID = `https://llun.test/users/${COHORT_USERNAME}`

    beforeAll(async () => {
      await database.createAccount({
        domain: 'llun.test',
        email: COHORT_EMAIL,
        username: COHORT_USERNAME,
        passwordHash: 'cohort-password-hash',
        privateKey: 'cohort-private-key',
        publicKey: 'cohort-public-key',
        verificationCode: 'code-the-backfill-left-behind'
      })
      // What `20260320072514_better_auth_columns` did to every row of its era:
      // marked verified while the code stayed put. `createAccount` cannot
      // produce this state, which is exactly why it has to be forced here.
      await instance('accounts')
        .where('email', COHORT_EMAIL)
        .update({ emailVerified: true })
    })

    test('serves a bearer token for a cohort account', async () => {
      mockGetServerSession.mockResolvedValue(null)
      mockStoredTokens.set(hashToken('cohort-token'), {
        token: hashToken('cohort-token'),
        referenceId: COHORT_ACTOR_ID,
        clientId: 'client-app-1',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['read'])
      })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(
        createRequest({ Authorization: 'Bearer cohort-token' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    test('serves a cookie session for a cohort account', async () => {
      // The other mapper. `getActorsForAccount` goes through
      // `toDomainAccount`, not `getActor`, so both need proving.
      mockGetServerSession.mockResolvedValue({ user: { email: COHORT_EMAIL } })

      const guard = OAuthGuard([Scope.enum.read], mockHandler)
      const response = await guard(createRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })
  })
})
