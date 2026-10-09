import type { Database } from '@/lib/database/types'
import { importFitnessFiles } from '@/lib/jobs/importFitnessFilesJob'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { Actor } from '@/lib/types/domain/actor'

// Helpers shared by the importFitnessFilesJob suites. They rely on the suite's
// `vi.mock` of `parseFitnessFile`, which is applied to this module as well
// because it is imported from inside the test file's module graph.
const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
>

export const createImportFileHelpers = (
  database: Database,
  getActor: () => Actor
) => {
  const createFitnessFile = (
    fileType: 'fit' | 'tcx',
    path: string,
    importBatchId: string
  ) =>
    database.createFitnessFile({
      actorId: getActor().id,
      path,
      fileName: path.split('/').pop()!,
      fileType,
      mimeType:
        fileType === 'fit' ? 'application/vnd.ant.fit' : 'application/tcx+xml',
      bytes: 1_024,
      importBatchId
    })

  const routedActivity: FitnessActivityData = {
    coordinates: [
      { lat: 13.7563, lng: 100.5018 },
      { lat: 13.76, lng: 100.505 }
    ],
    trackPoints: [],
    totalDistanceMeters: 18_000,
    totalDurationSeconds: 3_000,
    startTime: new Date('2026-02-01T08:00:00.000Z')
  }

  const importWithActivity = async (
    fileId: string,
    batchId: string,
    options: {
      overlapFitnessFileIds?: string[]
      notifyOnComplete?: boolean
      publishSendNote?: boolean
      preferRicherPrimary?: boolean
      replacePrimaryFileId?: string
      preserveExistingMapOnRetry?: boolean
    } = {}
  ) => {
    mockParseFitnessFile.mockResolvedValueOnce(routedActivity)
    return importFitnessFiles(database, {
      actorId: getActor().id,
      batchId,
      fitnessFileIds: [fileId],
      visibility: 'public',
      ...options
    })
  }

  return { createFitnessFile, routedActivity, importWithActivity }
}
