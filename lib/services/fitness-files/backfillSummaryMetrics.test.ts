import { FitnessFile } from '@/lib/types/database/fitnessFile'

import {
  type SummaryMetricsData,
  backfillFitnessSummaryMetrics
} from './backfillSummaryMetrics'

const baseFile = (overrides: Partial<FitnessFile>): FitnessFile => ({
  id: 'file-1',
  actorId: 'https://llun.test/users/test1',
  path: 'fitness/ride.fit',
  fileName: 'ride.fit',
  fileType: 'fit',
  mimeType: 'application/octet-stream',
  bytes: 1024,
  processingStatus: 'completed',
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

describe('backfillFitnessSummaryMetrics', () => {
  it('computes and persists summary metrics for a completed file that lacks them', async () => {
    const updates: Array<{ id: string; metrics: SummaryMetricsData }> = []

    const metricsData: SummaryMetricsData = {
      avgPower: 200,
      maxPower: 500,
      avgHeartRate: 140,
      maxHeartRate: 170,
      totalWorkKj: 350,
      elevationSeries: [10, 20, 30]
    }

    const result = await backfillFitnessSummaryMetrics({
      files: [baseFile({ id: 'ride' })],
      computeSummaryMetrics: async () => metricsData,
      updateSummaryMetrics: async (id, metrics) => {
        updates.push({ id, metrics })
      }
    })

    expect(updates).toEqual([{ id: 'ride', metrics: metricsData }])
    expect(result).toMatchObject({ updated: 1, skipped: 0, failed: 0 })
  })

  it('skips a file that already has summary metrics unless forced', async () => {
    const updates: string[] = []
    const params = {
      files: [
        baseFile({
          id: 'ride',
          avgPower: 200,
          avgHeartRate: 140,
          elevationSeries: [10, 20]
        })
      ],
      computeSummaryMetrics: async () => ({
        avgPower: 205,
        maxPower: 510,
        avgHeartRate: 142,
        maxHeartRate: 175,
        totalWorkKj: 360,
        elevationSeries: [10, 20, 30]
      }),
      updateSummaryMetrics: async (id: string) => {
        updates.push(id)
      }
    }

    const skipped = await backfillFitnessSummaryMetrics(params)
    expect(updates).toEqual([])
    expect(skipped).toMatchObject({ updated: 0, skipped: 1 })

    const forced = await backfillFitnessSummaryMetrics({
      ...params,
      force: true
    })
    expect(updates).toEqual(['ride'])
    expect(forced).toMatchObject({ updated: 1 })
  })

  it('skips files that are not completed or not parseable', async () => {
    let computeCalls = 0
    const result = await backfillFitnessSummaryMetrics({
      files: [
        baseFile({ id: 'pending', processingStatus: 'pending' }),
        baseFile({ id: 'zip', fileType: 'zip' })
      ],
      computeSummaryMetrics: async () => {
        computeCalls += 1
        return {
          avgPower: 100,
          maxPower: 200,
          avgHeartRate: 120,
          maxHeartRate: 150,
          totalWorkKj: 100,
          elevationSeries: []
        }
      },
      updateSummaryMetrics: async () => {}
    })

    expect(computeCalls).toBe(0)
    expect(result).toMatchObject({ updated: 0, skipped: 2 })
  })

  it('does not write during a dry run', async () => {
    const updates: string[] = []
    const result = await backfillFitnessSummaryMetrics({
      files: [baseFile({ id: 'ride' })],
      dryRun: true,
      computeSummaryMetrics: async () => ({
        avgPower: 200,
        maxPower: 500,
        avgHeartRate: 140,
        maxHeartRate: 170,
        totalWorkKj: 350,
        elevationSeries: [10, 20]
      }),
      updateSummaryMetrics: async (id) => {
        updates.push(id)
      }
    })

    expect(updates).toEqual([])
    expect(result).toMatchObject({ updated: 1 })
  })

  it('skips update when computed metrics match existing file values', async () => {
    const updates: string[] = []
    const result = await backfillFitnessSummaryMetrics({
      files: [
        baseFile({
          id: 'ride',
          avgPower: undefined,
          maxPower: undefined,
          avgHeartRate: undefined,
          maxHeartRate: undefined,
          totalWorkKj: undefined,
          elevationSeries: undefined
        })
      ],
      force: true,
      computeSummaryMetrics: async () => ({
        avgPower: null,
        maxPower: null,
        avgHeartRate: null,
        maxHeartRate: null,
        totalWorkKj: null,
        elevationSeries: null
      }),
      updateSummaryMetrics: async (id) => {
        updates.push(id)
      }
    })

    expect(updates).toEqual([])
    expect(result).toMatchObject({ updated: 0, skipped: 1, failed: 0 })
  })

  it('counts a compute failure and continues to the next file', async () => {
    const updates: string[] = []
    const result = await backfillFitnessSummaryMetrics({
      files: [
        baseFile({ id: 'broken' }),
        baseFile({ id: 'ok', path: 'fitness/ok.fit' })
      ],
      computeSummaryMetrics: async (file) => {
        if (file.id === 'broken') throw new Error('unreadable file')
        return {
          avgPower: 150,
          maxPower: 300,
          avgHeartRate: 130,
          maxHeartRate: 160,
          totalWorkKj: 250,
          elevationSeries: [5, 10]
        }
      },
      updateSummaryMetrics: async (id) => {
        updates.push(id)
      }
    })

    expect(updates).toEqual(['ok'])
    expect(result).toMatchObject({ updated: 1, skipped: 0, failed: 1 })
  })
})
