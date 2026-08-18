import { Database } from '@/lib/database/types'
import {
  FITNESS_FILE_ROUTE_SOURCE_VERSION,
  buildFitnessFileRoutePoints,
  downsampleRoutePoints,
  writeFitnessFileRoute
} from '@/lib/services/fitness-files/fileRouteCache'
import type { FitnessCoordinate } from '@/lib/services/fitness-files/parseFitnessFile'

const TEST_CONFIG = {
  memoryBudgetBytes: 512 * 1024 * 1024,
  accumulationPointLimit: 160_000,
  filePointLimit: 80_000,
  simplifyToleranceMeters: 1
}

describe('downsampleRoutePoints', () => {
  it('returns the input untouched when it already fits', () => {
    const points = [1, 2, 3]
    expect(downsampleRoutePoints(points, 3)).toBe(points)
  })

  it('decimates to exactly maxPoints keeping both endpoints', () => {
    const points = Array.from({ length: 1_000 }, (_value, index) => index)
    const sampled = downsampleRoutePoints(points, 10)

    expect(sampled).toHaveLength(10)
    expect(sampled[0]).toBe(0)
    expect(sampled[sampled.length - 1]).toBe(999)
  })
})

describe('buildFitnessFileRoutePoints', () => {
  it('returns an empty list for an activity with no coordinates', () => {
    expect(buildFitnessFileRoutePoints([], TEST_CONFIG)).toEqual([])
  })

  it('emits [lat, lng] tuples rounded to six decimals', () => {
    const points = buildFitnessFileRoutePoints(
      [
        { lat: 52.1234564, lng: 4.9876544 },
        { lat: 52.1234567, lng: 4.9876547 }
      ],
      TEST_CONFIG
    )

    expect(points).toEqual([
      [52.123456, 4.987654],
      [52.123457, 4.987655]
    ])
  })

  it('drops vertices that sit within the tolerance of the simplified line', () => {
    // A dead-straight run: Douglas-Peucker keeps only the endpoints, because
    // every interior vertex is 0m from the line joining them.
    const straight: FitnessCoordinate[] = Array.from(
      { length: 50 },
      (_value, index) => ({ lat: 52, lng: 4 + index * 0.0001 })
    )

    expect(buildFitnessFileRoutePoints(straight, TEST_CONFIG)).toEqual([
      [52, 4],
      [52, 4.0049]
    ])
  })

  it('keeps bends that deviate further than the tolerance', () => {
    // ~11m off the straight line at the midpoint, well past the 1m floor.
    const points = buildFitnessFileRoutePoints(
      [
        { lat: 52, lng: 4 },
        { lat: 52.0001, lng: 4.001 },
        { lat: 52, lng: 4.002 }
      ],
      TEST_CONFIG
    )

    expect(points).toHaveLength(3)
  })

  it('caps at filePointLimit before simplifying so a huge upload stays bounded', () => {
    // A staircase so no vertex is collinear and simplification cannot be what
    // reduces the count — this isolates the cap.
    const coordinates: FitnessCoordinate[] = Array.from(
      { length: 5_000 },
      (_value, index) => ({
        lat: 52 + index * 0.001 + (index % 2) * 0.005,
        lng: 4 + index * 0.001
      })
    )

    const points = buildFitnessFileRoutePoints(coordinates, {
      ...TEST_CONFIG,
      filePointLimit: 100
    })

    expect(points.length).toBeLessThanOrEqual(100)
  })
})

describe('writeFitnessFileRoute', () => {
  const createDatabase = () => {
    const upsertFitnessFileRoute = vi.fn()
    return {
      upsertFitnessFileRoute
    } as unknown as Database & {
      upsertFitnessFileRoute: ReturnType<typeof vi.fn>
    }
  }

  it('upserts the simplified route at the current source version', async () => {
    const database = createDatabase()

    const points = await writeFitnessFileRoute(database, {
      fitnessFileId: 'file-1',
      actorId: 'actor-1',
      coordinates: [
        { lat: 52, lng: 4 },
        { lat: 52.01, lng: 4.01 }
      ]
    })

    expect(points).toEqual([
      [52, 4],
      [52.01, 4.01]
    ])
    expect(database.upsertFitnessFileRoute).toHaveBeenCalledWith({
      fitnessFileId: 'file-1',
      actorId: 'actor-1',
      points,
      sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
    })
  })

  it('writes an empty row for an activity with no GPS, as a negative cache', async () => {
    const database = createDatabase()

    await writeFitnessFileRoute(database, {
      fitnessFileId: 'treadmill-1',
      actorId: 'actor-1',
      coordinates: []
    })

    expect(database.upsertFitnessFileRoute).toHaveBeenCalledWith({
      fitnessFileId: 'treadmill-1',
      actorId: 'actor-1',
      points: [],
      sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
    })
  })
})
