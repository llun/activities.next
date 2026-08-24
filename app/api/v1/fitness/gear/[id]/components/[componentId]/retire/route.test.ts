import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import {
  FitnessGear,
  FitnessGearComponent
} from '@/lib/types/database/fitnessGear'

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
  | 'getFitnessGear'
  | 'retireFitnessGearComponent'
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

const account = {
  id: 'account-1',
  email: seedActor1.email,
  defaultActorId: ACTOR1_ID,
  twoFactorEnabled: false,
  createdAt: 1000,
  updatedAt: 1000
}

const actor = {
  ...seedActor1,
  id: ACTOR1_ID,
  account,
  followersUrl: `${ACTOR1_ID}/followers`,
  inboxUrl: `${ACTOR1_ID}/inbox`,
  sharedInboxUrl: 'https://llun.test/inbox',
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1000,
  updatedAt: 1000
}

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

// The component routes now load the gear first, to 404 a stranger's id and 422
// a recording device. Every existing case is a bike, so this is the default.
const bikeGear: FitnessGear = {
  id: 'gear-1',
  actorId: ACTOR1_ID,
  kind: 'bike',
  name: 'Moots',
  defaultSports: [],
  createdAt: 1000,
  updatedAt: 1000
}

describe('Fitness gear component retire API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessGear: vi.fn(),
    retireFitnessGearComponent: vi.fn(),
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
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.getActorFromId.mockResolvedValue(actor)
    mockDb.getFitnessGearComponentDistanceRollups.mockResolvedValue({})
    mockDb.getFitnessGear.mockResolvedValue(bikeGear)
  })

  const params = {
    params: Promise.resolve({ id: 'gear-1', componentId: 'component-1' })
  }
  const url =
    'http://llun.test/api/v1/fitness/gear/gear-1/components/component-1/retire'

  it('returns the retired component', async () => {
    mockDb.retireFitnessGearComponent.mockResolvedValue(
      component({ removedAt: 1700 })
    )

    const response = await POST(
      new NextRequest(url, {
        method: 'POST',
        headers: { Origin: 'https://llun.test' }
      }),
      params
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.component).toMatchObject({
      id: 'component-1',
      removedAt: 1700
    })
    expect(mockDb.retireFitnessGearComponent).toHaveBeenCalledWith({
      id: 'component-1',
      gearId: 'gear-1',
      actorId: ACTOR1_ID
    })
  })

  it.each([
    { description: 'the component was already retired' },
    { description: 'the gear belongs to someone else' }
  ])('answers 404 when $description', async () => {
    mockDb.retireFitnessGearComponent.mockResolvedValue(null)

    const response = await POST(
      new NextRequest(url, {
        method: 'POST',
        headers: { Origin: 'https://llun.test' }
      }),
      params
    )
    expect(response.status).toBe(404)
  })

  it('rejects a recording device with 422', async () => {
    // A device has no parts to service — a chain does not wear out on a watch.
    mockDb.getFitnessGear.mockResolvedValue({
      ...bikeGear,
      kind: 'device',
      name: 'Garmin Edge 840'
    })

    const response = await POST(
      new NextRequest(url, {
        method: 'POST',
        headers: { Origin: 'https://llun.test' }
      }),
      params
    )
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.error).toBe('A recording device has no components')
    expect(mockDb.retireFitnessGearComponent).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON body', async () => {
    const response = await POST(
      new NextRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        },
        body: 'invalid-json{'
      }),
      params
    )
    expect(response.status).toBe(400)
    expect(mockDb.retireFitnessGearComponent).not.toHaveBeenCalled()
  })
})
