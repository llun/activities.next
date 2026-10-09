import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessSettings } from '@/lib/types/database/fitnessSettings'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockHost = vi.fn()
vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://test.llun.dev'),
  getConfig: () => ({
    host: mockHost(),
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

const settings = (overrides: Partial<FitnessSettings> = {}) =>
  ({
    id: 'wahoo-settings-1',
    actorId: ACTOR1_ID,
    serviceType: 'wahoo',
    clientId: 'wahoo-client-id',
    clientSecret: 'wahoo-client-secret',
    webhookToken: 'wahoo-webhook-token',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }) as FitnessSettings

describe('GET /api/v1/settings/fitness/wahoo/authorize', () => {
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'))
    mockHost.mockReturnValue('test.llun.dev')
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
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.getActorFromId.mockResolvedValue(actor)
    mockDb.getFitnessSettings.mockResolvedValue(settings())
    mockDb.updateFitnessSettings.mockResolvedValue(settings())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const authorize = () =>
    GET(
      new NextRequest(
        'https://test.llun.dev/api/v1/settings/fitness/wahoo/authorize'
      ),
      { params: Promise.resolve({}) }
    )

  it('redirects to Wahoo with the actor’s client id, the callback url, the scopes and a fresh state', async () => {
    const response = await authorize()

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') as string)
    expect(`${location.origin}${location.pathname}`).toBe(
      'https://api.wahooligan.com/oauth/authorize'
    )
    expect(Object.fromEntries(location.searchParams)).toEqual({
      client_id: 'wahoo-client-id',
      redirect_uri:
        'https://test.llun.dev/api/v1/settings/fitness/wahoo/callback',
      scope: 'user_read workouts_read offline_data',
      response_type: 'code',
      state: expect.stringMatching(/^[A-Za-z0-9]{48}$/)
    })
    expect(mockDb.getFitnessSettings).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      serviceType: 'wahoo'
    })
  })

  it('stores the same state the redirect carries, valid for ten minutes, so the callback can match it', async () => {
    const response = await authorize()

    const location = new URL(response.headers.get('location') as string)
    expect(mockDb.updateFitnessSettings).toHaveBeenCalledWith({
      id: 'wahoo-settings-1',
      oauthState: location.searchParams.get('state'),
      oauthStateExpiry: Date.parse('2026-03-01T10:10:00.000Z')
    })
  })

  it('issues a different state on every attempt', async () => {
    const first = await authorize()
    const second = await authorize()

    const states = [first, second].map((response) =>
      new URL(response.headers.get('location') as string).searchParams.get(
        'state'
      )
    )
    expect(states[0]).not.toBe(states[1])
  })

  it('uses http for the callback url on a localhost instance', async () => {
    mockHost.mockReturnValue('localhost:3000')

    const response = await authorize()

    const location = new URL(response.headers.get('location') as string)
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/v1/settings/fitness/wahoo/callback'
    )
  })

  it.each([
    ['no settings are saved', null],
    ['the client id is missing', settings({ clientId: undefined })],
    ['the client secret is missing', settings({ clientSecret: undefined })],
    ['the webhook token is missing', settings({ webhookToken: undefined })]
  ])('answers 400 and starts no OAuth flow when %s', async (_, saved) => {
    mockDb.getFitnessSettings.mockResolvedValue(saved)

    const response = await authorize()

    expect(response.status).toBe(400)
    expect(mockDb.updateFitnessSettings).not.toHaveBeenCalled()
  })

  it('redirects a signed-out caller to sign in without touching settings', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await authorize()

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/auth/signin')
    expect(mockDb.updateFitnessSettings).not.toHaveBeenCalled()
  })
})
