import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import {
  buildRecreateFitnessRouteHeatmapVariants,
  recreateFitnessRouteHeatmapJobs
} from '@/lib/jobs/recreateFitnessRouteHeatmapJobs'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { logger } from '@/lib/utils/logger'

const mockPublish = vi.fn()
const mockWarn = logger.warn as jest.Mock

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn(() => ({
    publish: mockPublish
  }))
}))
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: vi.fn()
  }
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
    mockPublish.mockReset()
    mockPublish.mockResolvedValue(undefined)
    mockWarn.mockReset()
  })

  it('deletes existing heatmaps and queues every discoverable actor variant', async () => {
    const getFitnessFilesByActor = vi
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
      getDistinctRouteHeatmapRegionsForActor: vi
        .fn()
        .mockResolvedValue(['encoded-region']),
      getFitnessFilesByActor,
      deleteFitnessRouteHeatmapsForActor: vi.fn().mockResolvedValue(3)
    }

    const result = await recreateFitnessRouteHeatmapJobs({
      database,
      actorId: 'actor-1',
      runId: 'test-run'
    })

    expect(
      database.getDistinctRouteHeatmapRegionsForActor
    ).toHaveBeenCalledWith({
      actorId: 'actor-1',
      includeDeleted: true
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
        data: expect.objectContaining({
          actorId: 'actor-1',
          activityType: 'run',
          periodType: 'monthly',
          periodKey: '2026-01',
          requestedAt: expect.any(Number)
        })
      })
    )
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: 'actor-1',
          activityType: 'cycle',
          periodType: 'monthly',
          periodKey: '2026-02',
          region: 'encoded-region',
          requestedAt: expect.any(Number)
        })
      })
    )
  })

  it('skips deletion and publishing in dry-run mode', async () => {
    const database = {
      getDistinctRouteHeatmapRegionsForActor: vi.fn().mockResolvedValue([]),
      getFitnessFilesByActor: vi
        .fn()
        .mockResolvedValueOnce([
          makeFitnessFile({
            activityStartTime: Date.UTC(2026, 4, 1)
          })
        ])
        .mockResolvedValueOnce([]),
      deleteFitnessRouteHeatmapsForActor: vi.fn()
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

  it('normalizes regions and collapses blank activity types into the all-activity bucket', () => {
    const variants = buildRecreateFitnessRouteHeatmapVariants({
      fitnessFiles: [
        makeFitnessFile({
          activityType: '  ',
          activityStartTime: undefined
        })
      ],
      regions: ['  region-b  ', '', 'region-a', 'region-a']
    })

    expect(variants).toEqual([
      {
        activityType: null,
        periodType: 'all_time',
        periodKey: 'all'
      },
      {
        activityType: null,
        periodType: 'all_time',
        periodKey: 'all',
        region: 'region-a'
      },
      {
        activityType: null,
        periodType: 'all_time',
        periodKey: 'all',
        region: 'region-b'
      }
    ])
  })

  it('paginates completed primary fitness files while deriving variants', async () => {
    const firstPage = Array.from({ length: 500 }, (_value, index) =>
      makeFitnessFile({
        id: `run-${index}`,
        activityType: 'run',
        activityStartTime: Date.UTC(2026, 0, 1)
      })
    )
    const getFitnessFilesByActor = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        makeFitnessFile({
          id: 'ride-501',
          activityType: 'ride',
          activityStartTime: Date.UTC(2026, 1, 1)
        })
      ])
    const database = {
      getDistinctRouteHeatmapRegionsForActor: vi.fn().mockResolvedValue([]),
      getFitnessFilesByActor,
      deleteFitnessRouteHeatmapsForActor: vi.fn()
    }

    const result = await recreateFitnessRouteHeatmapJobs({
      database,
      actorId: 'actor-1',
      dryRun: true
    })

    expect(getFitnessFilesByActor).toHaveBeenNthCalledWith(1, {
      actorId: 'actor-1',
      processingStatus: 'completed',
      isPrimary: true,
      limit: 500,
      offset: 0
    })
    expect(getFitnessFilesByActor).toHaveBeenNthCalledWith(2, {
      actorId: 'actor-1',
      processingStatus: 'completed',
      isPrimary: true,
      limit: 500,
      offset: 500
    })
    expect(result.variants).toEqual(
      expect.arrayContaining([
        {
          activityType: 'run',
          periodType: 'monthly',
          periodKey: '2026-01'
        },
        {
          activityType: 'ride',
          periodType: 'monthly',
          periodKey: '2026-02'
        }
      ])
    )
  })

  it('records per-variant publish failures without blocking other variants', async () => {
    mockPublish.mockImplementation((message) => {
      return message.data.periodType === 'monthly'
        ? Promise.reject(new Error('queue unavailable'))
        : Promise.resolve()
    })
    const database = {
      getDistinctRouteHeatmapRegionsForActor: vi.fn().mockResolvedValue([]),
      getFitnessFilesByActor: vi
        .fn()
        .mockResolvedValueOnce([
          makeFitnessFile({
            activityStartTime: Date.UTC(2026, 4, 1)
          })
        ])
        .mockResolvedValueOnce([]),
      deleteFitnessRouteHeatmapsForActor: vi.fn().mockResolvedValue(1)
    }

    const result = await recreateFitnessRouteHeatmapJobs({
      database,
      actorId: 'actor-1',
      runId: 'test-run'
    })

    expect(result.queuedCount).toBe(2)
    expect(result.failedCount).toBe(1)
    expect(result.errors).toEqual([
      {
        variant: {
          activityType: null,
          periodType: 'monthly',
          periodKey: '2026-05'
        },
        error: 'queue unavailable'
      }
    ])
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to publish route heatmap recreation job',
        actorId: 'actor-1',
        error: 'queue unavailable'
      })
    )
  })

  it('limits concurrent route heatmap publishes', async () => {
    const releasePublish: Array<() => void> = []
    let activePublishCount = 0
    let maxActivePublishCount = 0
    const expectedPublishCount = 26
    mockPublish.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          activePublishCount += 1
          maxActivePublishCount = Math.max(
            maxActivePublishCount,
            activePublishCount
          )
          releasePublish.push(() => {
            activePublishCount -= 1
            resolve()
          })
        })
    )
    const database = {
      getDistinctRouteHeatmapRegionsForActor: vi.fn().mockResolvedValue([]),
      getFitnessFilesByActor: vi
        .fn()
        .mockResolvedValueOnce(
          Array.from({ length: 6 }, (_value, index) =>
            makeFitnessFile({
              id: `fitness-file-${index}`,
              activityType: `activity-${index}`,
              activityStartTime: Date.UTC(2026, index, 1)
            })
          )
        )
        .mockResolvedValueOnce([]),
      deleteFitnessRouteHeatmapsForActor: vi.fn().mockResolvedValue(1)
    }

    const resultPromise = recreateFitnessRouteHeatmapJobs({
      database,
      actorId: 'actor-1',
      runId: 'test-run'
    })

    for (
      let guard = 0;
      guard < 10 && mockPublish.mock.calls.length < 4;
      guard += 1
    ) {
      await Promise.resolve()
    }

    expect(mockPublish).toHaveBeenCalledTimes(4)
    expect(maxActivePublishCount).toBe(4)

    for (
      let guard = 0;
      guard < 100 &&
      (mockPublish.mock.calls.length < expectedPublishCount ||
        activePublishCount > 0);
      guard += 1
    ) {
      const release = releasePublish.shift()
      release?.()
      await Promise.resolve()

      expect(maxActivePublishCount).toBeLessThanOrEqual(4)
    }

    const result = await resultPromise

    expect(mockPublish).toHaveBeenCalledTimes(expectedPublishCount)
    expect(result.queuedCount).toBe(expectedPublishCount)
    expect(result.failedCount).toBe(0)
  })
})
