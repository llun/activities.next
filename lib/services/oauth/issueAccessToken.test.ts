import knex from 'knex'
import { NextRequest } from 'next/server'

import { GET as verifyCredentials } from '@/app/api/v1/accounts/verify_credentials/route'
import { getSQLDatabase } from '@/lib/database/sql'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS } from '@/lib/services/auth/constants'
import { hashToken } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'

import { issueAccessToken } from './issueAccessToken'

const mockKnex = knex({
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: { filename: ':memory:' }
})
const mockDatabase = getSQLDatabase(mockKnex)

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => mockKnex
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null)
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

// Opaque tokens never reach better-auth's verifier, but the guard imports it.
vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const DOMAIN = 'llun.test'
const CLIENT_ID = 'issue-token-client'
const USERNAME = 'tokenuser'

describe('issueAccessToken', () => {
  let accountId: string
  let actorId: string

  beforeAll(async () => {
    await mockDatabase.migrate()

    await mockKnex('oauthClient').insert({
      id: 'oauth-client-row',
      clientId: CLIENT_ID,
      name: 'Issue Token App',
      scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
      redirectUris: JSON.stringify(['https://app.test/redirect']),
      requirePKCE: false,
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    accountId = await mockDatabase.createAccount({
      domain: DOMAIN,
      email: 'tokenuser@llun.test',
      username: USERNAME,
      name: 'Token User',
      passwordHash: 'hashed-password',
      verificationCode: null,
      privateKey: 'private-key',
      publicKey: 'public-key'
    })
    const actor = await mockDatabase.getActorFromUsername({
      username: USERNAME,
      domain: DOMAIN
    })
    actorId = actor!.id
  })

  afterAll(async () => {
    await mockKnex.destroy()
  })

  it('returns a raw token but persists only its hash', async () => {
    const issued = await issueAccessToken({
      database: mockDatabase,
      clientId: CLIENT_ID,
      accountId,
      actorId,
      scopes: [Scope.enum.read, Scope.enum.write]
    })

    expect(issued.token).toEqual(expect.any(String))
    expect(issued.scopes).toEqual([Scope.enum.read, Scope.enum.write])
    expect(issued.createdAt).toEqual(expect.any(Number))

    // The stored row holds the hash, never the raw token.
    const stored = await mockKnex('oauthAccessToken')
      .where('token', hashToken(issued.token))
      .first()
    expect(stored).toBeDefined()
    expect(stored.token).toBe(hashToken(issued.token))
    expect(stored.token).not.toBe(issued.token)
    expect(stored.userId).toBe(accountId)
    expect(stored.referenceId).toBe(actorId)
  })

  it('issues a token the OAuth guard accepts on verify_credentials', async () => {
    const issued = await issueAccessToken({
      database: mockDatabase,
      clientId: CLIENT_ID,
      accountId,
      actorId,
      scopes: [Scope.enum.read, Scope.enum.write]
    })

    const response = await verifyCredentials(
      new NextRequest('https://llun.test/api/v1/accounts/verify_credentials', {
        headers: { Authorization: `Bearer ${issued.token}` }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
  })

  // Mastodon clients never refresh, so the token they were handed has to stay
  // valid for as long as they keep using it. Driven against the real database
  // so the slide's UPDATE is the one the next request reads back.
  describe('sliding expiry', () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    const WINDOW_MS = OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000

    beforeEach(() => {
      // Only `Date` is faked: knex and better-sqlite3 rely on real timers.
      vi.useFakeTimers({ toFake: ['Date'] })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const verifyAt = async (token: string, time: number) => {
      vi.setSystemTime(time)
      const response = await verifyCredentials(
        new NextRequest(
          'https://llun.test/api/v1/accounts/verify_credentials',
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        { params: Promise.resolve({}) }
      )
      return response.status
    }

    const storedExpiresAt = async (token: string) => {
      const row = await mockKnex('oauthAccessToken')
        .where('token', hashToken(token))
        .first('expiresAt')
      return getCompatibleTime(row.expiresAt)
    }

    it('keeps a token valid while its client keeps using it', async () => {
      const issued = await issueAccessToken({
        database: mockDatabase,
        clientId: CLIENT_ID,
        accountId,
        actorId,
        scopes: [Scope.enum.read, Scope.enum.write]
      })
      expect(await storedExpiresAt(issued.token)).toBe(
        issued.createdAt + WINDOW_MS
      )

      // Used every five days, a token outlives the window several times over.
      // Before the slide the request on day 10 was the 401 that signed the
      // client out.
      for (const day of [5, 10, 15, 20]) {
        const now = issued.createdAt + day * DAY_MS
        expect(await verifyAt(issued.token, now)).toBe(200)
        expect(await storedExpiresAt(issued.token)).toBe(now + WINDOW_MS)
      }
    })

    it('lapses a full window after its last use', async () => {
      const issued = await issueAccessToken({
        database: mockDatabase,
        clientId: CLIENT_ID,
        accountId,
        actorId,
        scopes: [Scope.enum.read, Scope.enum.write]
      })
      const lastUse = issued.createdAt + 5 * DAY_MS

      expect(await verifyAt(issued.token, lastUse)).toBe(200)
      expect(await storedExpiresAt(issued.token)).toBe(lastUse + WINDOW_MS)

      // Idle for a full window after that use: the token has lapsed.
      expect(await verifyAt(issued.token, lastUse + WINDOW_MS + 1000)).toBe(401)
    })
  })

  it('rejects an unissued (forged) token', async () => {
    const response = await verifyCredentials(
      new NextRequest('https://llun.test/api/v1/accounts/verify_credentials', {
        headers: { Authorization: 'Bearer not-a-real-token' }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(401)
  })
})
