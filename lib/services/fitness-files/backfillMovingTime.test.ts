import { FitnessFile } from '@/lib/types/database/fitnessFile'

import { backfillFitnessMovingTime } from './backfillMovingTime'

const baseFile = (overrides: Partial<FitnessFile>): FitnessFile => ({
  id: 'file-1',
  actorId: 'https://llun.test/users/test1',
  path: 'fitness/ride.tcx',
  fileName: 'ride.tcx',
  fileType: 'tcx',
  mimeType: 'application/vnd.garmin.tcx+xml',
  bytes: 1024,
  processingStatus: 'completed',
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

describe('backfillFitnessMovingTime', () => {
  it('computes and persists moving time for a completed file that lacks it', async () => {
    const updates: Array<{ id: string; movingTimeSeconds: number }> = []

    const result = await backfillFitnessMovingTime({
      files: [baseFile({ id: 'ride', movingTimeSeconds: undefined })],
      computeMovingTimeSeconds: async () => 4374,
      updateMovingTimeSeconds: async (id, movingTimeSeconds) => {
        updates.push({ id, movingTimeSeconds })
      }
    })

    expect(updates).toEqual([{ id: 'ride', movingTimeSeconds: 4374 }])
    expect(result).toMatchObject({ updated: 1, skipped: 0, failed: 0 })
  })

  it('skips a file that already has moving time unless forced', async () => {
    const updates: string[] = []
    const params = {
      files: [baseFile({ id: 'ride', movingTimeSeconds: 4000 })],
      computeMovingTimeSeconds: async () => 4374,
      updateMovingTimeSeconds: async (id: string) => {
        updates.push(id)
      }
    }

    const skipped = await backfillFitnessMovingTime(params)
    expect(updates).toEqual([])
    expect(skipped).toMatchObject({ updated: 0, skipped: 1 })

    const forced = await backfillFitnessMovingTime({ ...params, force: true })
    expect(updates).toEqual(['ride'])
    expect(forced).toMatchObject({ updated: 1 })
  })

  it('skips files that are not completed or not parseable', async () => {
    let computeCalls = 0
    const result = await backfillFitnessMovingTime({
      files: [
        baseFile({ id: 'pending', processingStatus: 'pending' }),
        baseFile({ id: 'zip', fileType: 'zip' })
      ],
      computeMovingTimeSeconds: async () => {
        computeCalls += 1
        return 100
      },
      updateMovingTimeSeconds: async () => {}
    })

    expect(computeCalls).toBe(0)
    expect(result).toMatchObject({ updated: 0, skipped: 2 })
  })

  it('does not write during a dry run', async () => {
    const updates: string[] = []
    const result = await backfillFitnessMovingTime({
      files: [baseFile({ id: 'ride' })],
      dryRun: true,
      computeMovingTimeSeconds: async () => 4374,
      updateMovingTimeSeconds: async (id) => {
        updates.push(id)
      }
    })

    expect(updates).toEqual([])
    expect(result).toMatchObject({ updated: 1 })
  })

  it('counts a compute failure and continues to the next file', async () => {
    const updates: string[] = []
    const result = await backfillFitnessMovingTime({
      files: [
        baseFile({ id: 'broken' }),
        baseFile({ id: 'ok', path: 'fitness/ok.tcx' })
      ],
      computeMovingTimeSeconds: async (file) => {
        if (file.id === 'broken') throw new Error('unreadable file')
        return 3600
      },
      updateMovingTimeSeconds: async (id) => {
        updates.push(id)
      }
    })

    expect(updates).toEqual(['ok'])
    expect(result).toMatchObject({ updated: 1, failed: 1 })
  })
})
