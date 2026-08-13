import { Database } from '@/lib/database/types'
import {
  linkFitnessFileDeviceGear,
  resolveDeviceGear
} from '@/lib/services/fitness-gears/resolveDeviceGear'
import { FitnessGear } from '@/lib/types/database/fitnessGear'

const ACTOR_ID = 'actor-1'

const gear = (overrides: Partial<FitnessGear> = {}): FitnessGear => ({
  id: 'device-1',
  actorId: ACTOR_ID,
  kind: 'device',
  name: 'Garmin Edge 840',
  defaultSports: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

type MockDatabase = Pick<
  Database,
  | 'findFitnessGearByDeviceKey'
  | 'createFitnessGear'
  | 'updateFitnessFileActivityData'
>

const buildDatabase = (): jest.Mocked<MockDatabase> => ({
  findFitnessGearByDeviceKey: vi.fn(),
  createFitnessGear: vi.fn(),
  updateFitnessFileActivityData: vi.fn()
})

describe('resolveDeviceGear', () => {
  it('creates the device row the first time it is seen', async () => {
    const database = buildDatabase()
    database.findFitnessGearByDeviceKey.mockResolvedValue(null)
    database.createFitnessGear.mockResolvedValue(gear())

    const result = await resolveDeviceGear({
      database: database as unknown as Database,
      actorId: ACTOR_ID,
      deviceName: 'Garmin Edge 840',
      deviceManufacturer: 'garmin'
    })

    expect(result).toEqual({ id: 'device-1' })
    expect(database.createFitnessGear).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      kind: 'device',
      name: 'Garmin Edge 840',
      brand: 'Garmin',
      model: 'Edge 840',
      deviceKey: 'name:garmin edge 840',
      // Seeded from the brand map, so the manufacturer link the activity page
      // used to render inline moves onto the device row.
      productUrl: 'https://www.garmin.com'
    })
  })

  it('reuses the existing row and never mutates it', async () => {
    const database = buildDatabase()
    // The owner has since renamed it and pointed it at the product page.
    database.findFitnessGearByDeviceKey.mockResolvedValue(
      gear({ name: 'the Edge', productUrl: 'https://example.com/edge-840' })
    )

    const result = await resolveDeviceGear({
      database: database as unknown as Database,
      actorId: ACTOR_ID,
      deviceName: 'Garmin Edge 840',
      deviceManufacturer: 'garmin'
    })

    expect(result).toEqual({ id: 'device-1' })
    expect(database.createFitnessGear).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'no device information at all',
      deviceName: null,
      deviceManufacturer: null
    },
    {
      description: 'only an unrecognised numeric manufacturer code',
      deviceName: null,
      deviceManufacturer: '65535'
    }
  ])('creates nothing for $description', async (params) => {
    const database = buildDatabase()

    const result = await resolveDeviceGear({
      database: database as unknown as Database,
      actorId: ACTOR_ID,
      deviceName: params.deviceName,
      deviceManufacturer: params.deviceManufacturer
    })

    expect(result).toBeNull()
    expect(database.findFitnessGearByDeviceKey).not.toHaveBeenCalled()
    expect(database.createFitnessGear).not.toHaveBeenCalled()
  })

  it('adopts the winner’s row when a concurrent import inserts first', async () => {
    const database = buildDatabase()
    // Lookup misses, then the unique index rejects the insert, then the re-read
    // finds the row the winner wrote.
    database.findFitnessGearByDeviceKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(gear({ id: 'winner-1' }))
    database.createFitnessGear.mockRejectedValue(
      new Error('UNIQUE constraint failed')
    )

    const result = await resolveDeviceGear({
      database: database as unknown as Database,
      actorId: ACTOR_ID,
      deviceName: 'Garmin Edge 840',
      deviceManufacturer: 'garmin'
    })

    expect(result).toEqual({ id: 'winner-1' })
  })

  it('returns null when the insert fails for a reason no re-read explains', async () => {
    const database = buildDatabase()
    database.findFitnessGearByDeviceKey.mockResolvedValue(null)
    database.createFitnessGear.mockRejectedValue(new Error('database is down'))

    expect(
      await resolveDeviceGear({
        database: database as unknown as Database,
        actorId: ACTOR_ID,
        deviceName: 'Garmin Edge 840',
        deviceManufacturer: 'garmin'
      })
    ).toBeNull()
  })
})

describe('linkFitnessFileDeviceGear', () => {
  it('stamps the resolved device onto the activity', async () => {
    const database = buildDatabase()
    database.findFitnessGearByDeviceKey.mockResolvedValue(gear())

    const result = await linkFitnessFileDeviceGear({
      database: database as unknown as Database,
      actorId: ACTOR_ID,
      fitnessFileId: 'file-1',
      deviceName: 'Garmin Edge 840',
      deviceManufacturer: 'garmin'
    })

    expect(result).toBe('device-1')
    expect(database.updateFitnessFileActivityData).toHaveBeenCalledWith(
      'file-1',
      { deviceGearId: 'device-1' }
    )
  })

  it('writes nothing when the activity carries no device', async () => {
    const database = buildDatabase()

    expect(
      await linkFitnessFileDeviceGear({
        database: database as unknown as Database,
        actorId: ACTOR_ID,
        fitnessFileId: 'file-1'
      })
    ).toBeNull()
    expect(database.updateFitnessFileActivityData).not.toHaveBeenCalled()
  })

  it('swallows a write failure rather than failing the import', async () => {
    const database = buildDatabase()
    database.findFitnessGearByDeviceKey.mockResolvedValue(gear())
    database.updateFitnessFileActivityData.mockRejectedValue(
      new Error('write failed')
    )

    expect(
      await linkFitnessFileDeviceGear({
        database: database as unknown as Database,
        actorId: ACTOR_ID,
        fitnessFileId: 'file-1',
        deviceName: 'Garmin Edge 840'
      })
    ).toBeNull()
  })

  it('converges on the same row when the job re-runs', async () => {
    const database = buildDatabase()
    database.findFitnessGearByDeviceKey.mockResolvedValue(gear())

    await linkFitnessFileDeviceGear({
      database: database as unknown as Database,
      actorId: ACTOR_ID,
      fitnessFileId: 'file-1',
      deviceName: 'Garmin Edge 840'
    })
    await linkFitnessFileDeviceGear({
      database: database as unknown as Database,
      actorId: ACTOR_ID,
      fitnessFileId: 'file-1',
      deviceName: 'Garmin Edge 840'
    })

    expect(database.createFitnessGear).not.toHaveBeenCalled()
    expect(database.updateFitnessFileActivityData).toHaveBeenNthCalledWith(
      2,
      'file-1',
      { deviceGearId: 'device-1' }
    )
  })
})
