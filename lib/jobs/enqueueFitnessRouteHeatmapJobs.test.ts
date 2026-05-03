import { Database } from '@/lib/database/types'
import { enqueueFitnessRouteHeatmapJobs } from '@/lib/jobs/enqueueFitnessRouteHeatmapJobs'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

type MockDatabase = Pick<Database, 'getDistinctRouteHeatmapRegionsForActor'>

describe('enqueueFitnessRouteHeatmapJobs', () => {
  const mockDatabase: jest.Mocked<MockDatabase> = {
    getDistinctRouteHeatmapRegionsForActor: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.getDistinctRouteHeatmapRegionsForActor.mockResolvedValue([])
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
        data: {
          actorId: 'actor-1',
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-04'
        }
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
        data: {
          actorId: 'actor-1',
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026',
          region: 'netherlands'
        }
      })
    )
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: 'actor-1',
          activityType: null,
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'singapore'
        }
      })
    )
  })
})
