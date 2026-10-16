import { FitnessFile } from '@/lib/types/database/fitnessFile'

import {
  backfillFitnessRouteData,
  isRouteDataBackfillCandidate
} from './backfillRouteData'

describe('backfillRouteData', () => {
  const createFile = (overrides: Partial<FitnessFile> = {}): FitnessFile =>
    ({
      id: 'file-1',
      actorId: 'https://llun.test/users/test',
      path: 'fitness/file-1.fit',
      fileName: 'file-1.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024,
      processingStatus: 'completed',
      isPrimary: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides
    }) as FitnessFile

  describe('isRouteDataBackfillCandidate', () => {
    it('returns true for completed parseable files', () => {
      expect(isRouteDataBackfillCandidate(createFile())).toBe(true)
    })

    it('returns false for deleted or uncompleted files or unparseable formats', () => {
      expect(
        isRouteDataBackfillCandidate(createFile({ deletedAt: Date.now() }))
      ).toBe(false)
      expect(
        isRouteDataBackfillCandidate(
          createFile({ processingStatus: 'processing' })
        )
      ).toBe(false)
      expect(
        isRouteDataBackfillCandidate(
          createFile({ fileType: 'png' as unknown as FitnessFile['fileType'] })
        )
      ).toBe(false)
    })
  })

  describe('backfillFitnessRouteData', () => {
    it('skips files that already have route data when force is false', async () => {
      const file = createFile()
      const computeAndSaveRouteData = vi.fn()
      const hasRouteData = vi.fn().mockResolvedValue(true)

      const result = await backfillFitnessRouteData({
        files: [file],
        force: false,
        hasRouteData,
        computeAndSaveRouteData
      })

      expect(result).toEqual({ updated: 0, skipped: 1, failed: 0 })
      expect(computeAndSaveRouteData).not.toHaveBeenCalled()
    })

    it('processes files that already have route data when force is true', async () => {
      const file = createFile()
      const computeAndSaveRouteData = vi.fn().mockResolvedValue(undefined)
      const hasRouteData = vi.fn().mockResolvedValue(true)

      const result = await backfillFitnessRouteData({
        files: [file],
        force: true,
        hasRouteData,
        computeAndSaveRouteData
      })

      expect(result).toEqual({ updated: 1, skipped: 0, failed: 0 })
      expect(computeAndSaveRouteData).toHaveBeenCalledWith(file)
    })

    it('does not invoke computeAndSave in dry-run mode', async () => {
      const file = createFile()
      const computeAndSaveRouteData = vi.fn()
      const hasRouteData = vi.fn().mockResolvedValue(false)

      const result = await backfillFitnessRouteData({
        files: [file],
        dryRun: true,
        hasRouteData,
        computeAndSaveRouteData
      })

      expect(result).toEqual({ updated: 1, skipped: 0, failed: 0 })
      expect(computeAndSaveRouteData).not.toHaveBeenCalled()
    })

    it('handles failures without stopping other files', async () => {
      const file1 = createFile({ id: 'file-1' })
      const file2 = createFile({ id: 'file-2' })
      const computeAndSaveRouteData = vi
        .fn()
        .mockRejectedValueOnce(new Error('Corrupt file'))
        .mockResolvedValueOnce(undefined)
      const hasRouteData = vi.fn().mockResolvedValue(false)

      const result = await backfillFitnessRouteData({
        files: [file1, file2],
        hasRouteData,
        computeAndSaveRouteData
      })

      expect(result).toEqual({ updated: 1, skipped: 0, failed: 1 })
    })
  })
})
