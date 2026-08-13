import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import {
  FitnessGear,
  FitnessGearComponent
} from '@/lib/types/database/fitnessGear'

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
  | 'getFitnessGear'
  | 'updateFitnessGearComponent'
  | 'deleteFitnessGearComponent'
  | 'getFitnessGearComponents'
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

describe('Fitness gear component item API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessGear: vi.fn(),
    updateFitnessGearComponent: vi.fn(),
    deleteFitnessGearComponent: vi.fn(),
    getFitnessGearComponents: vi.fn(),
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
    mockDb.getFitnessGearComponents.mockResolvedValue([component()])
    mockDb.getFitnessGear.mockResolvedValue(bikeGear)
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
      // A body that cannot move the install window needs no extra read.
      expect(mockDb.getFitnessGearComponents).not.toHaveBeenCalled()
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

    // The schema's refine only sees the request body, so a one-sided PATCH has
    // to be checked against the stored row. Left unchecked it writes a window
    // no activity can fall inside: the part reads 0 km everywhere and its
    // service reminder can never fire.
    it('rejects a removal date that precedes the stored added date', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([
        component({ addedAt: 1_700_000_000_000 })
      ])

      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ removedAt: 1_600_000_000_000 })
        }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data).toEqual({ error: 'removedAt must be after addedAt' })
      expect(mockDb.updateFitnessGearComponent).not.toHaveBeenCalled()
    })

    it('rejects an added date that follows the stored removal date', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([
        component({ removedAt: 1_600_000_000_000 })
      ])

      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ addedAt: 1_700_000_000_000 })
        }),
        params
      )

      expect(response.status).toBe(422)
      expect(mockDb.updateFitnessGearComponent).not.toHaveBeenCalled()
    })

    it('accepts a removal date after the stored added date', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([
        component({ addedAt: 1_600_000_000_000 })
      ])
      mockDb.updateFitnessGearComponent.mockResolvedValue(
        component({
          addedAt: 1_600_000_000_000,
          removedAt: 1_700_000_000_000
        })
      )

      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ removedAt: 1_700_000_000_000 })
        }),
        params
      )

      expect(response.status).toBe(200)
      expect(mockDb.updateFitnessGearComponent).toHaveBeenCalled()
    })

    it('accepts clearing the removal date on a component with an added date', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([
        component({
          addedAt: 1_600_000_000_000,
          removedAt: 1_700_000_000_000
        })
      ])
      mockDb.updateFitnessGearComponent.mockResolvedValue(
        component({ addedAt: 1_600_000_000_000 })
      )

      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ removedAt: null })
        }),
        params
      )

      expect(response.status).toBe(200)
    })

    it('answers 404 when the window check cannot find the component', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([])

      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ removedAt: 1_700_000_000_000 })
        }),
        params
      )

      expect(response.status).toBe(404)
      expect(mockDb.updateFitnessGearComponent).not.toHaveBeenCalled()
    })

    it('rejects a recording device with 422', async () => {
      // A device has no parts to service — a chain does not wear out on a
      // watch.
      mockDb.getFitnessGear.mockResolvedValue({
        ...bikeGear,
        kind: 'device',
        name: 'Garmin Edge 840'
      })

      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ brand: 'Shimano' })
        }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.error).toBe('A recording device has no components')
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

    it('rejects a recording device with 422', async () => {
      mockDb.getFitnessGear.mockResolvedValue({
        ...bikeGear,
        kind: 'device',
        name: 'Garmin Edge 840'
      })

      const response = await DELETE(
        new NextRequest(url, {
          method: 'DELETE',
          headers: { Origin: 'https://llun.test' }
        }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.error).toBe('A recording device has no components')
      expect(mockDb.deleteFitnessGearComponent).not.toHaveBeenCalled()
    })
  })
})
