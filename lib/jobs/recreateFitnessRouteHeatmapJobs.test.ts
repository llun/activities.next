import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { recreateFitnessRouteHeatmapJobs } from '@/lib/jobs/recreateFitnessRouteHeatmapJobs'
import { FitnessFile } from '@/lib/types/database/fitnessFile'

const mockPublish = jest.fn()

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn(() => ({
    publish: mockPublish
  }))
}))

const makeFitnessFile = (
  overrides: Partial<FitnessFile> = {}
): FitnessFile => ({
  id: overrides.id ?? 'fitness-file-1',
  actorId: overrides.actorId ?? 'actor-1',
  path: overrides.path ?? 'fitness-file.fit',
  fileName: overrides.fileName ?? 'fitness-file.fit',
  fileType: overrides.fileType ?? 'fit',
  mimeType: overrides.mimeType ?? 'application/octet-stream',
  bytes: overrides.bytes ?? 1024,
  processingStatus: overrides.processingStatus ?? 'completed',
  isPrimary: overrides.isPrimary ?? true,
  activityType: overrides.activityType,
  activityStartTime: overrides.activityStartTime,
  createdAt: overrides.createdAt ?? Date.UTC(2026, 0, 1),
  updatedAt: overrides.updatedAt ?? Date.UTC(2026, 0, 1)
})

describe('recreateFitnessRouteHeatmapJobs', () => {
  beforeEach(() => {
    mockPublish.mockClear()
  })

  it('deletes existing heatmaps and queues every discoverable actor variant', async () => {
    const getFitnessFilesByActor = jest
      .fn()
      .mockResolvedValueOnce([
        makeFitnessFile({
          id: 'run-2026-01',
          activityType: 'run',
          activityStartTime: Date.UTC(2026, 0, 15, 8)
        }),
        makeFitnessFile({
          id: 'cycle-2026-02',
          activityType: 'cycle',
          activityStartTime: Date.UTC(2026, 1, 3, 10)
        })
      ])
      .mockResolvedValueOnce([])
    const database = {
      getDistinctRouteHeatmapRegionsForActor: jest
        .fn()
        .mockResolvedValue(['encoded-region']),
      getFitnessFilesByActor,
      deleteFitnessRouteHeatmapsForActor: jest.fn().mockResolvedValue(3)
    }

    const result = await recreateFitnessRouteHeatmapJobs({
      database,
      actorId: 'actor-1',
      runId: 'test-run'
    })

    expect(
      database.getDistinctRouteHeatmapRegionsForActor
    ).toHaveBeenCalledWith({
      actorId: 'actor-1'
    })
    expect(getFitnessFilesByActor).toHaveBeenNthCalledWith(1, {
      actorId: 'actor-1',
      processingStatus: 'completed',
      isPrimary: true,
      limit: 500,
      offset: 0
    })
    expect(database.deleteFitnessRouteHeatmapsForActor).toHaveBeenCalledWith({
      actorId: 'actor-1'
    })

    expect(result.deletedCount).toBe(3)
    expect(result.queuedCount).toBe(20)
    expect(result.failedCount).toBe(0)
    expect(result.variants).toEqual(
      expect.arrayContaining([
        {
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        },
        {
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026'
        },
        {
          activityType: null,
          periodType: 'monthly',
          periodKey: '2026-01'
        },
        {
          activityType: 'run',
          periodType: 'monthly',
          periodKey: '2026-01'
        },
        {
          activityType: 'cycle',
          periodType: 'monthly',
          periodKey: '2026-02',
          region: 'encoded-region'
        }
      ])
    )
    expect(mockPublish).toHaveBeenCalledTimes(20)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: 'actor-1',
          activityType: 'run',
          periodType: 'monthly',
          periodKey: '2026-01'
        }
      })
    )
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: 'actor-1',
          activityType: 'cycle',
          periodType: 'monthly',
          periodKey: '2026-02',
          region: 'encoded-region'
        }
      })
    )
  })

  it('skips deletion and publishing in dry-run mode', async () => {
    const database = {
      getDistinctRouteHeatmapRegionsForActor: jest.fn().mockResolvedValue([]),
      getFitnessFilesByActor: jest
        .fn()
        .mockResolvedValueOnce([
          makeFitnessFile({
            activityStartTime: Date.UTC(2026, 4, 1)
          })
        ])
        .mockResolvedValueOnce([]),
      deleteFitnessRouteHeatmapsForActor: jest.fn()
    }

    const result = await recreateFitnessRouteHeatmapJobs({
      database,
      actorId: 'actor-1',
      dryRun: true
    })

    expect(result.deletedCount).toBe(0)
    expect(result.queuedCount).toBe(0)
    expect(result.variants).toHaveLength(3)
    expect(database.deleteFitnessRouteHeatmapsForActor).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
