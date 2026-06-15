import { Database } from '@/lib/database/types'
import { enqueueFitnessRouteHeatmapJobs } from '@/lib/jobs/enqueueFitnessRouteHeatmapJobs'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

type MockDatabase = Pick<
  Database,
  'getDistinctRouteHeatmapRegionsForActor' | 'getFitnessRouteHeatmapByKey'
>

describe('enqueueFitnessRouteHeatmapJobs', () => {
  const mockDatabase: jest.Mocked<MockDatabase> = {
    getDistinctRouteHeatmapRegionsForActor: vi.fn(),
    getFitnessRouteHeatmapByKey: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getDistinctRouteHeatmapRegionsForActor.mockResolvedValue([])
    mockDatabase.getFitnessRouteHeatmapByKey.mockResolvedValue(null)
  })

  it('publishes standard route heatmap variants for all activity and activity type scopes', async () => {
    await enqueueFitnessRouteHeatmapJobs({
      database: mockDatabase as Database,
      actorId: 'actor-1',
      activityType: 'running',
      activityStartTime: new Date('2026-04-15T07:00:00.000Z')
    })

    expect(
      mockDatabase.getDistinctRouteHeatmapRegionsForActor
    ).toHaveBeenCalledWith({ actorId: 'actor-1' })
    expect(getQueue().publish).toHaveBeenCalledTimes(6)
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: 'actor-1',
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-04',
          requestedAt: expect.any(Number)
        })
      })
    )
  })

  it('versions job ids for route caches cleared before enqueue', async () => {
    const deletedAt = Date.now() - 1000
    mockDatabase.getFitnessRouteHeatmapByKey.mockImplementation(
      async ({ activityType, periodType, periodKey }) =>
        activityType === 'running' &&
        periodType === 'monthly' &&
        periodKey === '2026-04'
          ? ({
              id: 'deleted-route-cache',
              deletedAt
            } as Awaited<ReturnType<Database['getFitnessRouteHeatmapByKey']>>)
          : null
    )

    await enqueueFitnessRouteHeatmapJobs({
      database: mockDatabase as Database,
      actorId: 'actor-1',
      activityType: 'running',
      activityStartTime: new Date('2026-04-15T07:00:00.000Z')
    })

    expect(mockDatabase.getFitnessRouteHeatmapByKey).toHaveBeenCalledWith({
      actorId: 'actor-1',
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: '',
      includeDeleted: true
    })
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: getHashFromString(
          `actor-1:route-heatmap:running:monthly:2026-04::restore:deleted-route-cache:${deletedAt}`
        ),
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: 'actor-1',
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-04',
          requestedAt: expect.any(Number)
        })
      })
    )
  })

  it('publishes matching region variants from the distinct region query', async () => {
    mockDatabase.getDistinctRouteHeatmapRegionsForActor.mockResolvedValue([
      'netherlands',
      'singapore'
    ])

    await enqueueFitnessRouteHeatmapJobs({
      database: mockDatabase as Database,
      actorId: 'actor-1',
      activityType: null,
      activityStartTime: new Date('2026-04-15T07:00:00.000Z')
    })

    expect(getQueue().publish).toHaveBeenCalledTimes(9)
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: 'actor-1',
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026',
          region: 'netherlands',
          requestedAt: expect.any(Number)
        })
      })
    )
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: 'actor-1',
          activityType: null,
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'singapore',
          requestedAt: expect.any(Number)
        })
      })
    )
  })
})
