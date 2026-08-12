import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessGearComponent } from '@/lib/types/database/fitnessGear'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret-for-encryption',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  | 'replaceFitnessGearComponent'
  | 'getFitnessGearComponentDistanceRollups'
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

const component = (
  overrides: Partial<FitnessGearComponent> = {}
): FitnessGearComponent => ({
  id: 'component-1',
  gearId: 'gear-1',
  componentType: 'Chain',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

describe('Fitness gear component replace API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    replaceFitnessGearComponent: vi.fn(),
    getFitnessGearComponentDistanceRollups: vi.fn(),
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
    mockDb.getAccountFromEmail.mockResolvedValue({
      id: 'account-1',
      email: seedActor1.email,
      defaultActorId: ACTOR1_ID
    })
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...seedActor1, id: ACTOR1_ID }
    ])
    mockDb.getActorFromId.mockResolvedValue({ ...seedActor1, id: ACTOR1_ID })
    mockDb.getFitnessGearComponentDistanceRollups.mockResolvedValue({})
  })

  const params = {
    params: Promise.resolve({ id: 'gear-1', componentId: 'component-1' })
  }
  const url =
    'http://llun.test/api/v1/fitness/gear/gear-1/components/component-1/replace'

  it('returns the retired part alongside its replacement', async () => {
    mockDb.replaceFitnessGearComponent.mockResolvedValue({
      retired: component({ removedAt: 1700 }),
      replacement: component({ id: 'component-2', addedAt: 1700 })
    })

    const response = await POST(
      new NextRequest(url, {
        method: 'POST',
        headers: { Origin: 'https://llun.test' },
        body: JSON.stringify({})
      }),
      params
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.retired).toMatchObject({ id: 'component-1', removedAt: 1700 })
    expect(data.replacement).toMatchObject({
      id: 'component-2',
      addedAt: 1700,
      removedAt: null
    })
  })

  it('accepts an empty body, since the design replaces in one click', async () => {
    mockDb.replaceFitnessGearComponent.mockResolvedValue({
      retired: component({ removedAt: 1700 }),
      replacement: component({ id: 'component-2' })
    })

    const response = await POST(
      new NextRequest(url, {
        method: 'POST',
        headers: { Origin: 'https://llun.test' }
      }),
      params
    )

    expect(response.status).toBe(200)
    expect(mockDb.replaceFitnessGearComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'component-1',
        gearId: 'gear-1',
        actorId: ACTOR1_ID
      })
    )
  })

  // An empty body means "replace with a blank part"; a body that fails to parse
  // means the client sent something it expected us to read. Treating the second
  // as the first would retire the fitted part and drop the payload silently.
  it.each([
    { description: 'a truncated JSON payload', body: '{"brand": "Shim' },
    { description: 'a non-JSON payload', body: 'brand=Shimano' }
  ])(
    'answers 400 for $description without replacing anything',
    async ({ body }) => {
      const response = await POST(
        new NextRequest(url, {
          method: 'POST',
          headers: { Origin: 'https://llun.test' },
          body
        }),
        params
      )

      expect(response.status).toBe(400)
      expect(mockDb.replaceFitnessGearComponent).not.toHaveBeenCalled()
    }
  )

  it('answers 422 for a JSON body that is not an object', async () => {
    const response = await POST(
      new NextRequest(url, {
        method: 'POST',
        headers: { Origin: 'https://llun.test' },
        body: '"Shimano"'
      }),
      params
    )

    expect(response.status).toBe(422)
    expect(mockDb.replaceFitnessGearComponent).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'the component was already replaced' },
    { description: 'the gear belongs to someone else' }
  ])('answers 404 when $description', async () => {
    mockDb.replaceFitnessGearComponent.mockResolvedValue(null)

    const response = await POST(
      new NextRequest(url, {
        method: 'POST',
        headers: { Origin: 'https://llun.test' },
        body: JSON.stringify({})
      }),
      params
    )
    expect(response.status).toBe(404)
  })
})
