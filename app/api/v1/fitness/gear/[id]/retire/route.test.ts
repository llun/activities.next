import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessGear } from '@/lib/types/database/fitnessGear'

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
  | 'setFitnessGearRetired'
  | 'getFitnessGearDistanceRollups'
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

const gear = (overrides: Partial<FitnessGear> = {}): FitnessGear => ({
  id: 'gear-1',
  actorId: ACTOR1_ID,
  kind: 'bike',
  name: 'Moots',
  defaultSports: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

describe('Fitness gear retire API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    setFitnessGearRetired: vi.fn(),
    getFitnessGearDistanceRollups: vi.fn(),
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
    mockDb.getFitnessGearDistanceRollups.mockResolvedValue({})
  })

  const params = { params: Promise.resolve({ id: 'gear-1' }) }
  const request = (body: unknown) =>
    new NextRequest('http://llun.test/api/v1/fitness/gear/gear-1/retire', {
      method: 'POST',
      headers: { Origin: 'https://llun.test' },
      body: JSON.stringify(body)
    })

  it.each([
    { description: 'retires', retired: true, retiredAt: 1700 },
    { description: 'unretires', retired: false, retiredAt: undefined }
  ])('$description the gear', async ({ retired, retiredAt }) => {
    mockDb.setFitnessGearRetired.mockResolvedValue(gear({ retiredAt }))

    const response = await POST(request({ retired }), params)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.gear.retiredAt).toBe(retiredAt ?? null)
    expect(mockDb.setFitnessGearRetired).toHaveBeenCalledWith({
      id: 'gear-1',
      actorId: ACTOR1_ID,
      retired
    })
  })

  it('answers 404 for gear the actor does not own', async () => {
    mockDb.setFitnessGearRetired.mockResolvedValue(null)

    const response = await POST(request({ retired: true }), params)
    expect(response.status).toBe(404)
  })

  it.each([
    { description: 'the flag is missing', body: {} },
    { description: 'the flag is not a boolean', body: { retired: 'yes' } }
  ])('rejects with 422 when $description', async ({ body }) => {
    const response = await POST(request(body), params)
    expect(response.status).toBe(422)
    expect(mockDb.setFitnessGearRetired).not.toHaveBeenCalled()
  })
})
