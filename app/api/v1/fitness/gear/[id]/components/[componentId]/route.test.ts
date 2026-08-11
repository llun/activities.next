import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessGearComponent } from '@/lib/types/database/fitnessGear'

import { DELETE, PATCH } from './route'

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
  | 'updateFitnessGearComponent'
  | 'deleteFitnessGearComponent'
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

describe('Fitness gear component item API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    updateFitnessGearComponent: vi.fn(),
    deleteFitnessGearComponent: vi.fn(),
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
    'http://llun.test/api/v1/fitness/gear/gear-1/components/component-1'

  describe('PATCH', () => {
    it('updates only the fields the body carries', async () => {
      mockDb.updateFitnessGearComponent.mockResolvedValue(
        component({ brand: 'Shimano' })
      )

      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ brand: 'Shimano' })
        }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.component).toMatchObject({ brand: 'Shimano' })

      const callArgs = mockDb.updateFitnessGearComponent.mock.calls[0][0]
      expect(callArgs).toMatchObject({
        id: 'component-1',
        gearId: 'gear-1',
        actorId: ACTOR1_ID,
        brand: 'Shimano'
      })
      // Absent keys must not be forwarded, or the mixin would clear them.
      expect('addedAt' in callArgs).toBe(false)
      expect('serviceDistanceMeters' in callArgs).toBe(false)
    })

    it('answers 404 for a component the actor does not own', async () => {
      mockDb.updateFitnessGearComponent.mockResolvedValue(null)

      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ brand: 'Shimano' })
        }),
        params
      )
      expect(response.status).toBe(404)
    })

    it('rejects a removal date before the added date with 422', async () => {
      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({
            addedAt: 1_700_000_000_000,
            removedAt: 1_600_000_000_000
          })
        }),
        params
      )
      expect(response.status).toBe(422)
      expect(mockDb.updateFitnessGearComponent).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('deletes the component', async () => {
      mockDb.deleteFitnessGearComponent.mockResolvedValue(true)

      const response = await DELETE(
        new NextRequest(url, {
          method: 'DELETE',
          headers: { Origin: 'https://llun.test' }
        }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ success: true })
    })

    it('answers 404 when nothing was deleted', async () => {
      mockDb.deleteFitnessGearComponent.mockResolvedValue(false)

      const response = await DELETE(
        new NextRequest(url, {
          method: 'DELETE',
          headers: { Origin: 'https://llun.test' }
        }),
        params
      )
      expect(response.status).toBe(404)
    })
  })
})
