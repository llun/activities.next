import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { IMPORT_WAHOO_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessSettings } from '@/lib/types/database/fitnessSettings'

import { GET, POST } from './route'

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

const mockPublish = vi.fn()
const mockRunsInline = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    publish: mockPublish,
    get runsInline() {
      return mockRunsInline()
    }
  })
}))

type MockDatabase = Pick<
  Database,
  | 'getWahooImportsByActor'
  | 'getWahooImport'
  | 'getFitnessSettings'
  | 'markWahooImportPending'
  | 'markWahooImportFailed'
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

const IMPORT_ID = '5b0f1d6e-0c52-4c57-8f0e-3f6a1d3d9a11'

const wahooImport = (overrides: Record<string, unknown> = {}) =>
  ({
    id: IMPORT_ID,
    actorId: ACTOR1_ID,
    workoutId: 'workout-1',
    providerUserId: 'wahoo-user-1',
    status: 'failed',
    lastError: 'Could not parse FIT file',
    ...overrides
  }) as unknown as Awaited<ReturnType<Database['getWahooImport']>>

const connectedSettings = (overrides: Partial<FitnessSettings> = {}) =>
  ({
    id: 'wahoo-settings-1',
    actorId: ACTOR1_ID,
    serviceType: 'wahoo',
    accessToken: 'access-token',
    providerUserId: 'wahoo-user-1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }) as FitnessSettings

describe('Wahoo failed imports API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getWahooImportsByActor: vi.fn(),
    getWahooImport: vi.fn(),
    getFitnessSettings: vi.fn(),
    markWahooImportPending: vi.fn(),
    markWahooImportFailed: vi.fn(),
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
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.getActorFromId.mockResolvedValue(actor)
    mockDb.getWahooImportsByActor.mockResolvedValue([])
    mockDb.getWahooImport.mockResolvedValue(wahooImport())
    mockDb.getFitnessSettings.mockResolvedValue(connectedSettings())
    mockDb.markWahooImportPending.mockResolvedValue(true)
    mockDb.markWahooImportFailed.mockResolvedValue(undefined as never)
    mockRunsInline.mockReturnValue(false)
    mockPublish.mockResolvedValue(undefined)
  })

  const get = () =>
    GET(new NextRequest('https://test.llun.dev/api/v1/fitness/wahoo/imports'), {
      params: Promise.resolve({})
    })

  const post = (body: unknown) =>
    POST(
      new NextRequest('https://test.llun.dev/api/v1/fitness/wahoo/imports', {
        method: 'POST',
        headers: { Origin: 'https://test.llun.dev' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      }),
      { params: Promise.resolve({}) }
    )

  describe('GET', () => {
    it('lists only the caller’s failed and unsupported imports, exposing just the fields the settings page needs', async () => {
      mockDb.getWahooImportsByActor.mockResolvedValue([
        {
          ...wahooImport(),
          accessTokenSnapshot: 'should-not-leak',
          payload: { secret: true }
        },
        wahooImport({
          id: 'second',
          workoutId: 'workout-2',
          status: 'unsupported',
          lastError: undefined
        })
      ] as never)

      const response = await get()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        imports: [
          {
            id: IMPORT_ID,
            workoutId: 'workout-1',
            status: 'failed',
            lastError: 'Could not parse FIT file'
          },
          { id: 'second', workoutId: 'workout-2', status: 'unsupported' }
        ]
      })
      expect(mockDb.getWahooImportsByActor).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        statuses: ['failed', 'unsupported'],
        limit: 25
      })
    })
  })

  describe('POST (retry)', () => {
    it('re-queues a failed import and marks it pending', async () => {
      const response = await post({ importId: IMPORT_ID })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
      expect(mockDb.markWahooImportPending).toHaveBeenCalledWith(IMPORT_ID)
      expect(mockPublish).toHaveBeenCalledWith({
        id: expect.any(String),
        name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
        data: {
          importId: IMPORT_ID,
          notifyOnComplete: true,
          ignoreHistoryCancellation: true
        }
      })
    })

    it('does not notify again for an import that belongs to a history import', async () => {
      mockDb.getWahooImport.mockResolvedValue(
        wahooImport({ status: 'unsupported', historyImportId: 'history-1' })
      )

      await post({ importId: IMPORT_ID })

      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ notifyOnComplete: false })
        })
      )
    })

    it('refuses with 503 when jobs would run inline', async () => {
      mockRunsInline.mockReturnValue(true)

      const response = await post({ importId: IMPORT_ID })

      expect(response.status).toBe(503)
      expect(mockDb.markWahooImportPending).not.toHaveBeenCalled()
    })

    it('answers 400 for a body that is not JSON', async () => {
      const response = await post('{nope')

      expect(response.status).toBe(400)
    })

    it.each([
      ['missing', {}],
      ['not a uuid', { importId: 'workout-1' }],
      ['not a string', { importId: 42 }]
    ])('answers 422 when importId is %s', async (_, body) => {
      const response = await post(body)

      expect(response.status).toBe(422)
      expect(mockPublish).not.toHaveBeenCalled()
    })

    it.each([
      ['does not exist', () => mockDb.getWahooImport.mockResolvedValue(null)],
      [
        'belongs to another actor',
        () =>
          mockDb.getWahooImport.mockResolvedValue(
            wahooImport({ actorId: 'https://llun.test/users/test2' })
          )
      ],
      [
        'is not in a retryable state',
        () =>
          mockDb.getWahooImport.mockResolvedValue(
            wahooImport({ status: 'completed' })
          )
      ],
      [
        'has no Wahoo connection to retry with',
        () => mockDb.getFitnessSettings.mockResolvedValue(null)
      ],
      [
        'has a connection without an access token',
        () =>
          mockDb.getFitnessSettings.mockResolvedValue(
            connectedSettings({ accessToken: undefined })
          )
      ],
      [
        'was recorded for a different Wahoo account than the connected one',
        () =>
          mockDb.getFitnessSettings.mockResolvedValue(
            connectedSettings({ providerUserId: 'someone-else' })
          )
      ]
    ])(
      'answers 409 and queues nothing when the import %s',
      async (_, arrange) => {
        arrange()

        const response = await post({ importId: IMPORT_ID })

        expect(response.status).toBe(409)
        expect(mockDb.markWahooImportPending).not.toHaveBeenCalled()
        expect(mockPublish).not.toHaveBeenCalled()
      }
    )

    it('answers 409 without queueing when another request already took the import', async () => {
      mockDb.markWahooImportPending.mockResolvedValue(false)

      const response = await post({ importId: IMPORT_ID })

      expect(response.status).toBe(409)
      expect(mockPublish).not.toHaveBeenCalled()
    })

    it('marks the import failed again and answers 503 when queueing fails', async () => {
      mockPublish.mockRejectedValue(new Error('queue down'))

      const response = await post({ importId: IMPORT_ID })

      expect(response.status).toBe(503)
      expect(mockDb.markWahooImportFailed).toHaveBeenCalledWith(
        IMPORT_ID,
        'failed',
        'Failed to queue Wahoo activity. Retry from settings.'
      )
    })
  })
})
