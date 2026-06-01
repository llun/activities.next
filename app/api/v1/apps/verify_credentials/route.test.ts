import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { Client } from '@/lib/types/oauth2/client'

import { GET } from './route'

const hashToken = (token: string) =>
  crypto
    .createHash('sha256')
    .update(token)
    .digest()
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

// Token store consulted by the guard's getKnex() lookup.
const mockStoredTokens = new Map<string, Record<string, unknown>>()
// Clients resolved by getClientFromAccessToken, keyed by hashed token.
const mockClients = new Map<string, Client>()

const mockGetActorFromId = jest.fn().mockResolvedValue(null)
const mockGetClientFromAccessToken = jest
  .fn()
  .mockImplementation(({ hashedToken }: { hashedToken: string }) =>
    Promise.resolve(mockClients.get(hashedToken) ?? null)
  )

const mockDatabase = {
  getActorFromId: mockGetActorFromId,
  getClientFromAccessToken: mockGetClientFromAccessToken
}

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => (_table: string) => ({
    where: (_field: string, value: string) => ({
      first: () => Promise.resolve(mockStoredTokens.get(value) ?? null)
    })
  })
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => Promise.resolve(null)
}))

// All tokens under test are opaque, so verifyAccessToken is never invoked; the
// mock just keeps the better-auth ESM module out of the transform path.
jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    push: { vapidPublicKey: 'vapid-public-key' }
  }),
  getBaseURL: () => 'https://llun.test'
}))

const buildClient = (overrides: Partial<Client> = {}): Client =>
  Client.parse({
    id: 'client-row-1',
    clientId: 'client-app-1',
    name: 'Test App',
    redirectUris: ['https://app.example.com/callback'],
    scopes: ['read'],
    website: 'https://app.example.com',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  })

const createRequest = (token?: string) =>
  new NextRequest('https://llun.test/api/v1/apps/verify_credentials', {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })

describe('GET /api/v1/apps/verify_credentials', () => {
  beforeEach(() => {
    mockStoredTokens.clear()
    mockClients.clear()
    mockGetActorFromId.mockClear()
    mockGetClientFromAccessToken.mockClear()
  })

  test('returns 200 with client details for an app token (null referenceId)', async () => {
    mockStoredTokens.set(hashToken('app-token'), {
      token: hashToken('app-token'),
      referenceId: null,
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(['read'])
    })
    mockClients.set(hashToken('app-token'), buildClient())

    const response = await GET(createRequest('app-token'), {
      params: Promise.resolve({})
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      name: 'Test App',
      website: 'https://app.example.com',
      vapid_key: 'vapid-public-key'
    })
    // App tokens have no actor; the route never resolves one.
    expect(mockGetActorFromId).not.toHaveBeenCalled()
  })

  test('returns 200 for a user token', async () => {
    mockStoredTokens.set(hashToken('user-token'), {
      token: hashToken('user-token'),
      referenceId: 'https://llun.test/users/llun',
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(['read'])
    })
    mockGetActorFromId.mockResolvedValueOnce({
      id: 'https://llun.test/users/llun',
      username: 'llun',
      domain: 'llun.test',
      followersUrl: 'https://llun.test/users/llun/followers',
      inboxUrl: 'https://llun.test/users/llun/inbox',
      sharedInboxUrl: 'https://llun.test/inbox',
      followingCount: 0,
      followersCount: 0,
      statusCount: 0,
      lastStatusAt: null,
      publicKey: 'public-key',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    mockClients.set(hashToken('user-token'), buildClient({ name: 'User App' }))

    const response = await GET(createRequest('user-token'), {
      params: Promise.resolve({})
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.name).toBe('User App')
  })

  test('returns 401 for an expired token', async () => {
    mockStoredTokens.set(hashToken('expired-token'), {
      token: hashToken('expired-token'),
      referenceId: null,
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() - 1000),
      scopes: JSON.stringify(['read'])
    })

    const response = await GET(createRequest('expired-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
  })

  test('returns 401 for a revoked/unknown token', async () => {
    const response = await GET(createRequest('unknown-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
  })

  test('returns 401 when no bearer token is provided', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
  })
})
