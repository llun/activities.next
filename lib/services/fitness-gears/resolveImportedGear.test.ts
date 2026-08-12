import { Database } from '@/lib/database/types'
import {
  getStravaGearName,
  inferStravaGearKind,
  resolveArchiveGearByName,
  resolveStravaGear
} from '@/lib/services/fitness-gears/resolveImportedGear'
import { getStravaGear } from '@/lib/services/strava/activity'

vi.mock('@/lib/services/strava/activity', async () => {
  const actual = await vi.importActual('@/lib/services/strava/activity')
  return {
    ...actual,
    getStravaGear: vi.fn()
  }
})

const mockGetStravaGear = getStravaGear as jest.MockedFunction<
  typeof getStravaGear
>

type MockDatabase = Pick<
  Database,
  | 'findFitnessGearByStravaGearId'
  | 'findFitnessGearByName'
  | 'createFitnessGear'
>

const createDatabase = (): jest.Mocked<MockDatabase> => ({
  findFitnessGearByStravaGearId: vi.fn().mockResolvedValue(null),
  findFitnessGearByName: vi.fn().mockResolvedValue(null),
  createFitnessGear: vi.fn()
})

const asDatabase = (database: jest.Mocked<MockDatabase>) =>
  database as unknown as Database

describe('inferStravaGearKind', () => {
  it.each([
    {
      description: 'a b-prefixed id is a bike',
      stravaGearId: 'b1234567',
      gear: null,
      activityType: null,
      expected: 'bike'
    },
    {
      description: 'a g-prefixed id is shoes',
      stravaGearId: 'g7654321',
      gear: null,
      activityType: null,
      expected: 'shoes'
    },
    {
      description: 'the prefix beats a contradicting activity type',
      stravaGearId: 'b1234567',
      gear: null,
      activityType: 'Run',
      expected: 'bike'
    },
    {
      description: 'an unknown prefix with a frame type is a bike',
      stravaGearId: 'x1234567',
      gear: { id: 'x1234567', frame_type: 3 },
      activityType: 'Run',
      expected: 'bike'
    },
    {
      description: 'an unknown prefix falls back to the activity sport',
      stravaGearId: 'x1234567',
      gear: { id: 'x1234567' },
      activityType: 'GravelRide',
      expected: 'bike'
    },
    {
      description: 'an unknown prefix with no other signal is shoes',
      stravaGearId: 'x1234567',
      gear: null,
      activityType: 'Swim',
      expected: 'shoes'
    }
  ])('$description', ({ stravaGearId, gear, activityType, expected }) => {
    expect(inferStravaGearKind({ stravaGearId, gear, activityType })).toBe(
      expected
    )
  })
})

describe('getStravaGearName', () => {
  it.each([
    {
      description: 'joins the brand and model',
      gear: { id: 'b1', brand_name: 'Moots', model_name: 'Routt 45' },
      expected: 'Moots Routt 45'
    },
    {
      description: 'uses the brand alone when there is no model',
      gear: { id: 'b1', brand_name: 'Moots' },
      expected: 'Moots'
    },
    {
      description: 'falls back to the athlete nickname',
      gear: { id: 'b1', name: 'Winter bike' },
      expected: 'Winter bike'
    },
    {
      description: 'falls back to a placeholder with no details at all',
      gear: null,
      expected: 'Strava gear b1'
    }
  ])('$description', ({ gear, expected }) => {
    expect(getStravaGearName('b1', gear)).toBe(expected)
  })

  it('caps the name at the column size', () => {
    const name = getStravaGearName('b1', {
      id: 'b1',
      brand_name: 'M'.repeat(400)
    })
    expect(name).toHaveLength(255)
  })

  it('leaves no trailing space when the cut lands mid-word', () => {
    // 254 characters, then a space, then more: the 255-character slice ends on
    // the space. Storing that space makes the stored name differ from the one
    // the next activity looks up by.
    const name = getStravaGearName('b1', {
      id: 'b1',
      brand_name: `${'M'.repeat(254)} Routt 45`
    })

    expect(name).toBe('M'.repeat(254))
    expect(name).toBe(name.trim())
  })
})

describe('resolveStravaGear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStravaGear.mockResolvedValue(null)
  })

  it('returns the existing gear without fetching or creating anything', async () => {
    const database = createDatabase()
    database.findFitnessGearByStravaGearId.mockResolvedValue({
      id: 'gear-1'
    } as never)

    const resolved = await resolveStravaGear({
      database: asDatabase(database),
      actorId: 'actor-1',
      stravaGearId: 'b1234567',
      accessToken: 'token'
    })

    expect(resolved).toEqual({ id: 'gear-1' })
    expect(mockGetStravaGear).not.toHaveBeenCalled()
    expect(database.createFitnessGear).not.toHaveBeenCalled()
  })

  it('creates the gear from Strava details the first time it is seen', async () => {
    const database = createDatabase()
    mockGetStravaGear.mockResolvedValue({
      id: 'b1234567',
      name: 'Winter bike',
      brand_name: 'Moots',
      model_name: 'Routt 45',
      frame_type: 3
    })
    database.createFitnessGear.mockResolvedValue({ id: 'gear-new' } as never)

    const resolved = await resolveStravaGear({
      database: asDatabase(database),
      actorId: 'actor-1',
      stravaGearId: 'b1234567',
      accessToken: 'token',
      activityType: 'Ride'
    })

    expect(resolved).toEqual({ id: 'gear-new' })
    expect(database.createFitnessGear).toHaveBeenCalledWith({
      actorId: 'actor-1',
      kind: 'bike',
      name: 'Moots Routt 45',
      brand: 'Moots',
      model: 'Routt 45',
      stravaGearId: 'b1234567'
    })
  })

  // A 404/401 is settled input — the gear is gone or unreadable and never
  // coming back, so a placeholder is the right permanent answer.
  it('creates gear with a placeholder name when Strava does not know the gear', async () => {
    const database = createDatabase()
    mockGetStravaGear.mockResolvedValue(null)
    database.createFitnessGear.mockResolvedValue({ id: 'gear-new' } as never)

    const resolved = await resolveStravaGear({
      database: asDatabase(database),
      actorId: 'actor-1',
      stravaGearId: 'g7654321',
      accessToken: 'token'
    })

    expect(resolved).toEqual({ id: 'gear-new' })
    expect(database.createFitnessGear).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'shoes',
        name: 'Strava gear g7654321',
        brand: null,
        model: null
      })
    )
  })

  // A throw is a rate limit or an outage, not a missing gear. Creating the
  // placeholder here would be permanent: the id lookup short-circuits from the
  // next activity onwards and nothing ever mutates an existing gear row.
  it('leaves the activity unattributed when the detail fetch throws', async () => {
    const database = createDatabase()
    mockGetStravaGear.mockRejectedValue(new Error('Too Many Requests'))

    const resolved = await resolveStravaGear({
      database: asDatabase(database),
      actorId: 'actor-1',
      stravaGearId: 'g7654321',
      accessToken: 'token'
    })

    expect(resolved).toBeNull()
    expect(database.createFitnessGear).not.toHaveBeenCalled()
  })

  it('returns the winner of a unique-index race instead of failing', async () => {
    const database = createDatabase()
    database.findFitnessGearByStravaGearId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'gear-winner' } as never)
    database.createFitnessGear.mockRejectedValue(
      new Error('UNIQUE constraint failed')
    )

    const resolved = await resolveStravaGear({
      database: asDatabase(database),
      actorId: 'actor-1',
      stravaGearId: 'b1234567',
      accessToken: 'token'
    })

    expect(resolved).toEqual({ id: 'gear-winner' })
  })

  it('returns null when the create fails and no row exists to fall back to', async () => {
    const database = createDatabase()
    database.createFitnessGear.mockRejectedValue(new Error('database is down'))

    const resolved = await resolveStravaGear({
      database: asDatabase(database),
      actorId: 'actor-1',
      stravaGearId: 'b1234567',
      accessToken: 'token'
    })

    expect(resolved).toBeNull()
  })

  it('returns null for a blank gear id without touching the database', async () => {
    const database = createDatabase()

    const resolved = await resolveStravaGear({
      database: asDatabase(database),
      actorId: 'actor-1',
      stravaGearId: '   ',
      accessToken: 'token'
    })

    expect(resolved).toBeNull()
    expect(database.findFitnessGearByStravaGearId).not.toHaveBeenCalled()
  })
})

describe('resolveArchiveGearByName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reuses the gear already stored under that name', async () => {
    const database = createDatabase()
    database.findFitnessGearByName.mockResolvedValue({ id: 'gear-1' } as never)

    const resolved = await resolveArchiveGearByName({
      database: asDatabase(database),
      actorId: 'actor-1',
      name: 'Moots Routt 45',
      kind: 'bike'
    })

    expect(resolved).toEqual({ id: 'gear-1' })
    expect(database.createFitnessGear).not.toHaveBeenCalled()
  })

  it('creates gear with no Strava id when the name is new', async () => {
    const database = createDatabase()
    database.createFitnessGear.mockResolvedValue({ id: 'gear-new' } as never)

    const resolved = await resolveArchiveGearByName({
      database: asDatabase(database),
      actorId: 'actor-1',
      name: '  Nimbus 25  ',
      kind: 'shoes'
    })

    expect(resolved).toEqual({ id: 'gear-new' })
    expect(database.createFitnessGear).toHaveBeenCalledWith({
      actorId: 'actor-1',
      kind: 'shoes',
      name: 'Nimbus 25'
    })
  })

  // The truncated name is both what we look up by and what we store, so it has
  // to be identical on both sides — a 255-character cut that lands on a space
  // must not leave one behind.
  it('looks up and stores the same truncated name for an over-long one', async () => {
    const database = createDatabase()
    database.createFitnessGear.mockResolvedValue({ id: 'gear-new' } as never)

    await resolveArchiveGearByName({
      database: asDatabase(database),
      actorId: 'actor-1',
      name: `${'M'.repeat(254)} Routt 45`,
      kind: 'bike'
    })

    const lookedUpName = database.findFitnessGearByName.mock.calls[0][0].name
    const storedName = database.createFitnessGear.mock.calls[0][0].name

    expect(storedName).toBe(lookedUpName)
    expect(storedName).toBe('M'.repeat(254))
  })

  it('returns null for a blank name without touching the database', async () => {
    const database = createDatabase()

    const resolved = await resolveArchiveGearByName({
      database: asDatabase(database),
      actorId: 'actor-1',
      name: '   ',
      kind: 'bike'
    })

    expect(resolved).toBeNull()
    expect(database.findFitnessGearByName).not.toHaveBeenCalled()
  })
})
