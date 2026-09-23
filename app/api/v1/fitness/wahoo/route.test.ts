import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessSettings } from '@/lib/types/database/fitnessSettings'

import { POST } from './route'

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

type MockDatabase = Pick<
  Database,
  | 'getFitnessSettings'
  | 'updateFitnessSettings'
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
    mockDb.getFitnessSettings.mockResolvedValue(existingSettings())
    mockDb.updateFitnessSettings.mockResolvedValue(existingSettings())
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
})
