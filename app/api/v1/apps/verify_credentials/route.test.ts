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
// Clients resolved by getClientFromId, keyed by clientId.
const mockClients = new Map<string, Client>()

const mockGetActorFromId = vi.fn().mockResolvedValue(null)
const mockGetClientFromId = vi
  .fn()
  .mockImplementation(({ clientId }: { clientId: string }) =>
    Promise.resolve(mockClients.get(clientId) ?? null)
  )

const mockDatabase = {
  getActorFromId: mockGetActorFromId,
  getClientFromId: mockGetClientFromId
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => (_table: string) => ({
    where: (_field: string, value: string) => ({
      first: () => Promise.resolve(mockStoredTokens.get(value) ?? null)
    })
  })
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => Promise.resolve(null)
}))

// All tokens under test are opaque, so verifyAccessToken is never invoked; the
// mock just keeps the better-auth ESM module out of the transform path.
vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
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
    mockGetClientFromId.mockClear()
  })

  test('returns 200 with client details for an app token (null referenceId)', async () => {
    mockStoredTokens.set(hashToken('app-token'), {
      token: hashToken('app-token'),
      referenceId: null,
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(['read'])
    })
    mockClients.set('client-app-1', buildClient())

    const response = await GET(createRequest('app-token'), {
      params: Promise.resolve({})
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      id: 'client-row-1',
      name: 'Test App',
      website: 'https://app.example.com',
      scopes: ['read'],
      redirect_uris: ['https://app.example.com/callback'],
      redirect_uri: 'https://app.example.com/callback',
      vapid_key: 'vapid-public-key'
    })
    // App tokens have no actor; the route never resolves one.
    expect(mockGetActorFromId).not.toHaveBeenCalled()
  })

  test('returns 200 with generic defaults when the owning client row is missing', async () => {
    // Valid token whose client row was deleted: the route must still respond
    // 200 with the generic 'Web' / null fallbacks, not crash or 401.
    mockStoredTokens.set(hashToken('orphan-token'), {
      token: hashToken('orphan-token'),
      referenceId: null,
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(['read'])
    })
    // mockClients intentionally left empty → getClientFromId returns null.

    const response = await GET(createRequest('orphan-token'), {
      params: Promise.resolve({})
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      name: 'Web',
      website: null,
      scopes: [],
      redirect_uris: [],
      redirect_uri: '',
      vapid_key: 'vapid-public-key'
    })
  })

  test('joins multiple registered redirect URIs with newlines in redirect_uri', async () => {
    mockStoredTokens.set(hashToken('multi-token'), {
      token: hashToken('multi-token'),
      referenceId: null,
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(['read'])
    })
    mockClients.set(
      'client-app-1',
      buildClient({
        redirectUris: [
          'https://app.example.com/callback',
          'https://app.example.com/alt-callback'
        ]
      })
    )

    const response = await GET(createRequest('multi-token'), {
      params: Promise.resolve({})
    })
    const data = await response.json()

    expect(data.redirect_uris).toEqual([
      'https://app.example.com/callback',
      'https://app.example.com/alt-callback'
    ])
    expect(data.redirect_uri).toBe(
      'https://app.example.com/callback\nhttps://app.example.com/alt-callback'
    )
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
    mockClients.set('client-app-1', buildClient({ name: 'User App' }))

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
