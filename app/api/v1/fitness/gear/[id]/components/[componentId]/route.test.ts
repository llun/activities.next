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

// `addedAt` and `removedAt` are derived from the install periods, so a fixture
// setting either gets a matching single period unless the test states its own.
const component = (
  overrides: Partial<FitnessGearComponent> = {}
): FitnessGearComponent => {
  const built = {
    id: 'component-1',
    gearId: 'gear-1',
    componentType: 'Chain',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  }
  return {
    ...built,
    periods: overrides.periods ?? [
      {
        id: 'period-1',
        componentId: built.id,
        installSequence: 1,
        addedAt: built.addedAt,
        removedAt: built.removedAt,
        createdAt: built.createdAt,
        updatedAt: built.updatedAt
      }
    ]
  }
}

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

    // A refitted component, whose derived pair comes from two DIFFERENT periods:
    // `addedAt` is P1's start and `removedAt` is P2's end. Validating a request
    // against that pair compares bounds that do not belong together — which is
    // what let an inverting edit through with a 200 and dropped the period's
    // distance for good.
    const refittedComponent = () =>
      component({
        addedAt: Date.UTC(2026, 0, 1),
        removedAt: undefined,
        periods: [
          {
            id: 'period-1',
            componentId: 'component-1',
            installSequence: 1,
            addedAt: Date.UTC(2026, 0, 1),
            removedAt: Date.UTC(2026, 2, 1),
            createdAt: 1000,
            updatedAt: 1000
          },
          {
            id: 'period-2',
            componentId: 'component-1',
            installSequence: 2,
            addedAt: Date.UTC(2026, 4, 1),
            createdAt: 1000,
            updatedAt: 1000
          }
        ]
      })

    it('refuses a removal date that would invert the last period of a refitted component', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([refittedComponent()])

      // After the first period's end and before the last period's start. It is
      // later than the component's derived `addedAt` (Jan 1), so the old check
      // passed it; it lands on the LAST period, turning it into
      // [May 1, Feb 15) — a range no activity can satisfy.
      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ removedAt: Date.UTC(2026, 1, 15) })
        }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.error).toBe('removedAt must be after addedAt')
      expect(mockDb.updateFitnessGearComponent).not.toHaveBeenCalled()
    })

    it('refuses an added date that would invert the first period of a refitted component', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([refittedComponent()])

      // The mirror case, and the one the old check could not see at all: the
      // component's derived `removedAt` is null while the last period is open,
      // so the guard short-circuited and accepted anything. This lands on the
      // FIRST period, turning it into [Aug 1, Mar 1).
      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ addedAt: Date.UTC(2026, 7, 1) })
        }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.error).toBe('removedAt must be after addedAt')
      expect(mockDb.updateFitnessGearComponent).not.toHaveBeenCalled()
    })

    it('accepts an edit that keeps both periods of a refitted component ordered', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([refittedComponent()])
      mockDb.updateFitnessGearComponent.mockResolvedValue(refittedComponent())

      // Inside the first period's own bounds, so nothing inverts. The point is
      // that the stricter check did not become a blanket refusal of every
      // multi-period edit.
      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({ addedAt: Date.UTC(2026, 1, 1) })
        }),
        params
      )

      expect(response.status).toBe(200)
      expect(mockDb.updateFitnessGearComponent).toHaveBeenCalled()
    })

    // Both bounds land on the same row when there is one period, so that case
    // has to be checked against BOTH new values rather than one new and one
    // stored — otherwise moving a window wholesale is refused for crossing the
    // bound it is itself replacing.
    it('accepts moving both ends of a single-period component past the old window', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([
        component({
          addedAt: Date.UTC(2026, 0, 1),
          removedAt: Date.UTC(2026, 2, 1)
        })
      ])
      mockDb.updateFitnessGearComponent.mockResolvedValue(component())

      const response = await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: JSON.stringify({
            addedAt: Date.UTC(2026, 3, 1),
            removedAt: Date.UTC(2026, 8, 1)
          })
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
