import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessSettings } from '@/lib/types/database/fitnessSettings'

import { DELETE, GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://test.llun.dev'),
  getConfig: vi.fn().mockReturnValue({
    host: 'test.llun.dev',
    secretPhase: 'test-secret-for-encryption',
    allowEmails: [],
    allowActorDomains: []
  })
}))

const mockRunsInline = vi.fn().mockReturnValue(false)
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    get runsInline() {
      return mockRunsInline()
    }
  })
}))

const mockWithImportLock = vi.fn()
vi.mock('@/lib/services/fitness-files/importLock', () => ({
  withImportLock: (...args: unknown[]) => mockWithImportLock(...args)
}))

type MockDatabase = Pick<
  Database,
  | 'getFitnessSettings'
  | 'updateFitnessSettings'
  | 'createFitnessSettings'
  | 'deleteFitnessSettings'
  | 'cancelWahooHistoryImportsByActor'
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

const existingSettings = (): FitnessSettings => ({
  id: 'wahoo-settings-1',
  actorId: ACTOR1_ID,
  serviceType: 'wahoo',
  clientId: 'saved-client-id',
  clientSecret: 'saved-client-secret',
  webhookToken: 'saved-webhook-token',
  createdAt: 1,
  updatedAt: 1
})

describe('Wahoo Settings API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessSettings: vi.fn(),
    updateFitnessSettings: vi.fn(),
    createFitnessSettings: vi.fn(),
    deleteFitnessSettings: vi.fn(),
    cancelWahooHistoryImportsByActor: vi.fn(),
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    getActorFromId: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const account = {
      id: 'account-1',
      email: seedActor1.email,
      defaultActorId: ACTOR1_ID,
      twoFactorEnabled: false,
      emailVerified: true,
      createdAt: 1,
      updatedAt: 1
    }
    const actor = {
      ...seedActor1,
      id: ACTOR1_ID,
      followersUrl: `${ACTOR1_ID}/followers`,
      inboxUrl: `${ACTOR1_ID}/inbox`,
      sharedInboxUrl: 'https://example.test/inbox',
      statusCount: 0,
      lastStatusAt: null,
      createdAt: 1,
      updatedAt: 1,
      account
    }
    mockRunsInline.mockReturnValue(false)
    mockWithImportLock.mockImplementation(
      async (_db: unknown, _key: string, fn: () => Promise<unknown>) => fn()
    )
    mockDb.getFitnessSettings.mockResolvedValue(existingSettings())
    mockDb.updateFitnessSettings.mockResolvedValue(existingSettings())
    // Tests below override these with persistent implementations and
    // rejections; vi.clearAllMocks keeps those, so reset them every time.
    mockDb.cancelWahooHistoryImportsByActor.mockReset()
    mockDb.cancelWahooHistoryImportsByActor.mockResolvedValue(undefined)
    mockDb.deleteFitnessSettings.mockReset()
    mockDb.deleteFitnessSettings.mockResolvedValue(undefined)
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.getActorFromId.mockResolvedValue(actor)
  })

  it('preserves the saved client secret when the settings form submits it blank', async () => {
    const request = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/wahoo',
      {
        method: 'POST',
        headers: { Origin: 'https://test.llun.dev' },
        body: JSON.stringify({
          clientId: 'saved-client-id',
          clientSecret: '',
          webhookToken: '',
          environment: 'sandbox',
          defaultVisibility: 'private'
        })
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.updateFitnessSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'wahoo-settings-1',
        clientId: 'saved-client-id'
      })
    )
    expect(mockDb.updateFitnessSettings.mock.calls[0]?.[0]).not.toHaveProperty(
      'clientSecret'
    )
    expect(mockDb.updateFitnessSettings.mock.calls[0]?.[0]).not.toHaveProperty(
      'webhookToken'
    )
  })

  it.each(['x', '1234567'])(
    'rejects a webhook token shorter than 8 characters (%s)',
    async (webhookToken) => {
      const request = new NextRequest(
        'https://test.llun.dev/api/v1/fitness/wahoo',
        {
          method: 'POST',
          headers: { Origin: 'https://test.llun.dev' },
          body: JSON.stringify({ webhookToken })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })

      expect(response.status).toBe(422)
      expect(mockDb.updateFitnessSettings).not.toHaveBeenCalled()
    }
  )

  it('accepts an 8-character webhook token', async () => {
    const request = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/wahoo',
      {
        method: 'POST',
        headers: { Origin: 'https://test.llun.dev' },
        body: JSON.stringify({ webhookToken: '12345678' })
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.updateFitnessSettings).toHaveBeenCalledWith(
      expect.objectContaining({ webhookToken: '12345678' })
    )
  })

  it('returns conflict when the saved settings row was deleted before update', async () => {
    mockDb.updateFitnessSettings.mockResolvedValueOnce(null)
    const request = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/wahoo',
      {
        method: 'POST',
        headers: { Origin: 'https://test.llun.dev' },
        body: JSON.stringify({ clientId: 'updated-client-id' })
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(409)
    expect(mockDb.updateFitnessSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'wahoo-settings-1',
        clientId: 'updated-client-id'
      })
    )
  })

  it('returns a readable conflict when the webhook binding is already in use', async () => {
    mockDb.updateFitnessSettings.mockRejectedValueOnce(
      Object.assign(new Error('UNIQUE constraint failed'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE'
      })
    )
    const request = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/wahoo',
      {
        method: 'POST',
        headers: { Origin: 'https://test.llun.dev' },
        body: JSON.stringify({ webhookToken: 'another-token' })
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'This Wahoo account and webhook token are already connected'
    })
  })

  const call = (
    handler: typeof GET | typeof POST | typeof DELETE,
    method: string,
    body?: unknown
  ) =>
    handler(
      new NextRequest('https://test.llun.dev/api/v1/fitness/wahoo', {
        method,
        headers: { Origin: 'https://test.llun.dev' },
        body:
          body === undefined
            ? undefined
            : typeof body === 'string'
              ? body
              : JSON.stringify(body)
      }),
      { params: Promise.resolve({}) }
    )

  describe('GET', () => {
    it('reports defaults for an actor with no saved Wahoo settings', async () => {
      mockDb.getFitnessSettings.mockResolvedValue(null)

      const response = await call(GET, 'GET')

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        configured: false,
        connected: false,
        hasClientSecret: false,
        hasWebhookToken: false,
        environment: 'sandbox',
        defaultVisibility: 'private',
        callbackUrl:
          'https://test.llun.dev/api/v1/settings/fitness/wahoo/callback',
        webhookUrl: 'https://test.llun.dev/api/v1/webhooks/wahoo/',
        automaticImportAvailable: true
      })
    })

    it('reports saved settings as flags and never returns the secret or the tokens', async () => {
      mockDb.getFitnessSettings.mockResolvedValue({
        ...existingSettings(),
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        providerUserId: 'wahoo-user-1',
        providerEnvironment: 'production',
        defaultVisibility: 'unlisted',
        lastWebhookAt: Date.UTC(2026, 0, 2, 3, 4, 5),
        lastImportAt: Date.UTC(2026, 0, 3),
        connectionError: 'Token expired'
      })

      const response = await call(GET, 'GET')
      const text = await response.text()
      const json = JSON.parse(text)

      expect(json).toMatchObject({
        configured: true,
        connected: true,
        actorId: ACTOR1_ID,
        clientId: 'saved-client-id',
        hasClientSecret: true,
        hasWebhookToken: true,
        environment: 'production',
        defaultVisibility: 'unlisted',
        providerUserId: 'wahoo-user-1',
        lastWebhookAt: '2026-01-02T03:04:05.000Z',
        lastImportAt: '2026-01-03T00:00:00.000Z',
        lastError: 'Token expired'
      })
      expect(json.actorHandle).toBe(
        `@${seedActor1.username}@${seedActor1.domain}`
      )
      expect(text).not.toContain('saved-client-secret')
      expect(text).not.toContain('saved-webhook-token')
      expect(text).not.toContain('access-secret')
      expect(text).not.toContain('refresh-secret')
    })

    it('is not connected until the provider user is known', async () => {
      mockDb.getFitnessSettings.mockResolvedValue({
        ...existingSettings(),
        accessToken: 'access-secret'
      })

      const response = await call(GET, 'GET')

      expect(await response.json()).toMatchObject({ connected: false })
    })

    it('says automatic import is unavailable when the queue runs jobs inline', async () => {
      mockRunsInline.mockReturnValue(true)

      const response = await call(GET, 'GET')

      expect(await response.json()).toMatchObject({
        automaticImportAvailable: false
      })
    })
  })

  describe('POST', () => {
    const post = (body: unknown) => call(POST, 'POST', body)

    it('creates settings for an actor that has none, defaulting to sandbox and private', async () => {
      mockDb.getFitnessSettings.mockResolvedValue(null)

      const response = await post({
        clientId: 'new-client',
        clientSecret: 'new-secret',
        webhookToken: 'new-webhook-token'
      })

      expect(response.status).toBe(200)
      expect(mockDb.createFitnessSettings).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        serviceType: 'wahoo',
        clientId: 'new-client',
        clientSecret: 'new-secret',
        webhookToken: 'new-webhook-token',
        providerEnvironment: 'sandbox',
        defaultVisibility: 'private'
      })
      expect(mockDb.updateFitnessSettings).not.toHaveBeenCalled()
    })

    it.each([
      ['client id', { clientSecret: 'secret', webhookToken: 'token-12345' }],
      ['client secret', { clientId: 'id', webhookToken: 'token-12345' }],
      ['webhook token', { clientId: 'id', clientSecret: 'secret' }]
    ])('requires a %s when nothing is saved yet', async (_, body) => {
      mockDb.getFitnessSettings.mockResolvedValue(null)

      const response = await post(body)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Client ID, client secret and webhook token are required'
      })
      expect(mockDb.createFitnessSettings).not.toHaveBeenCalled()
    })

    it('answers 400 for a body that is not JSON', async () => {
      const response = await post('{nope')

      expect(response.status).toBe(400)
    })

    it.each([
      ['an unknown environment', { environment: 'staging' }],
      ['an unknown visibility', { defaultVisibility: 'everyone' }],
      ['an empty client id', { clientId: '   ' }],
      ['an over-long client secret', { clientSecret: 'x'.repeat(2049) }]
    ])('answers 422 for %s', async (_, body) => {
      const response = await post(body)

      expect(response.status).toBe(422)
      expect(mockDb.updateFitnessSettings).not.toHaveBeenCalled()
    })

    it('signs the actor out of Wahoo when the client secret changes', async () => {
      await post({ clientSecret: 'rotated-secret' })

      expect(mockDb.updateFitnessSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          clientSecret: 'rotated-secret',
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          providerUserId: null,
          grantedScopes: null,
          oauthState: null,
          oauthStateExpiry: null
        })
      )
    })

    it('signs the actor out of Wahoo when the client id changes', async () => {
      await post({ clientId: 'another-app' })

      expect(mockDb.updateFitnessSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'another-app',
          accessToken: null,
          refreshToken: null,
          providerUserId: null
        })
      )
    })

    it('keeps the connection when only preferences change', async () => {
      await post({
        clientId: 'saved-client-id',
        clientSecret: 'saved-client-secret',
        environment: 'production',
        defaultVisibility: 'public'
      })

      const update = mockDb.updateFitnessSettings.mock.calls[0][0]
      expect(update).toMatchObject({
        providerEnvironment: 'production',
        defaultVisibility: 'public'
      })
      expect(update).not.toHaveProperty('accessToken')
      expect(update).not.toHaveProperty('oauthState')
    })

    it('rethrows database failures that are not a duplicate binding', async () => {
      mockDb.updateFitnessSettings.mockRejectedValueOnce(
        new Error('connection lost')
      )

      await expect(post({ clientId: 'x' })).rejects.toThrow('connection lost')
    })
  })

  describe('DELETE', () => {
    it('cancels pending history imports and then removes the settings, under both locks', async () => {
      const order: string[] = []
      mockWithImportLock.mockImplementation(
        async (_db: unknown, key: string, fn: () => Promise<unknown>) => {
          order.push(`lock:${key}`)
          return fn()
        }
      )
      mockDb.cancelWahooHistoryImportsByActor.mockImplementation(async () => {
        order.push('cancel')
      })
      mockDb.deleteFitnessSettings.mockImplementation(async () => {
        order.push('delete')
      })

      const response = await call(DELETE, 'DELETE')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
      expect(order).toEqual([
        `lock:fitness-import:${ACTOR1_ID}`,
        `lock:wahoo-history-start:${ACTOR1_ID}`,
        'cancel',
        'delete'
      ])
      expect(mockDb.cancelWahooHistoryImportsByActor).toHaveBeenCalledWith(
        ACTOR1_ID
      )
      expect(mockDb.deleteFitnessSettings).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        serviceType: 'wahoo'
      })
    })

    it('answers 503 and keeps the settings when an import holds the lock', async () => {
      mockWithImportLock.mockRejectedValue(
        new Error('Timed out acquiring import lock')
      )

      const response = await call(DELETE, 'DELETE')

      expect(response.status).toBe(503)
      expect(mockDb.deleteFitnessSettings).not.toHaveBeenCalled()
    })

    it('answers 503 when removing the settings fails', async () => {
      mockDb.deleteFitnessSettings.mockRejectedValue(new Error('db down'))

      const response = await call(DELETE, 'DELETE')

      expect(response.status).toBe(503)
    })
  })
})
