import knex from 'knex'
import { NextRequest } from 'next/server'

import { GET as verifyCredentials } from '@/app/api/v1/accounts/verify_credentials/route'
import { getSQLDatabase } from '@/lib/database/sql'
import { hashToken } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'

import { issueAccessToken } from './issueAccessToken'

const mockKnex = knex({
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: { filename: ':memory:' }
})
const mockDatabase = getSQLDatabase(mockKnex)

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => mockKnex
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn().mockResolvedValue(null)
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

// Opaque tokens never reach better-auth's verifier, but the guard imports it.
jest.mock('better-auth/oauth2', () => ({ verifyAccessToken: jest.fn() }))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
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
