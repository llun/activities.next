import { z } from 'zod'

import { IMPORT_FITNESS_FILES_JOB_NAME } from '@/lib/jobs/names'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import { getStravaArchiveSourceBatchId } from '@/lib/services/strava/archiveImport'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  batchId: string
}

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]
const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

type BatchStatus = 'pending' | 'completed' | 'failed' | 'partially_failed'

type BatchFileState = 'pending' | 'completed' | 'failed'

const STRAVA_ARCHIVE_BATCH_PREFIX = 'strava-archive:'

const getArchiveSourceBatchId = (batchId: string): string | null => {
  if (!batchId.startsWith(STRAVA_ARCHIVE_BATCH_PREFIX)) {
    return null
  }

  const archiveId = batchId.slice(STRAVA_ARCHIVE_BATCH_PREFIX.length)
  if (archiveId.length === 0) {
    return null
  }

  return getStravaArchiveSourceBatchId(archiveId)
}

const getBatchFileState = (file: FitnessFile): BatchFileState => {
  const importStatus = file.importStatus ?? 'pending'
  const processingStatus = file.processingStatus ?? 'pending'

  if (importStatus === 'failed' || processingStatus === 'failed') {
    return 'failed'
  }

  if (
    importStatus === 'pending' ||
    processingStatus === 'pending' ||
    processingStatus === 'processing'
  ) {
    return 'pending'
  }

  return 'completed'
}

const summarizeBatch = (files: FitnessFile[]) => {
  const total = files.length
  const fileStates = files.map(getBatchFileState)
  const pending = fileStates.filter((state) => state === 'pending').length
  const completed = fileStates.filter((state) => state === 'completed').length
  const failed = fileStates.filter((state) => state === 'failed').length

  let status: BatchStatus = 'completed'
  if (pending > 0) {
    status = 'pending'
  } else if (failed > 0 && completed > 0) {
    status = 'partially_failed'
  } else if (failed > 0 && completed === 0) {
    status = 'failed'
  }

  return {
    status,
    total,
    pending,
    completed,
    failed
  }
}

const getSingleBatchActorId = (files: FitnessFile[]): string | null => {
  const actorIds = Array.from(new Set(files.map((item) => item.actorId)))
  if (actorIds.length !== 1) {
    return null
  }
  return actorIds[0] ?? null
}

const isBatchOwnedByCurrentAccount = async ({
  files,
  currentActorId,
  currentAccountId,
  database
}: {
  files: FitnessFile[]
  currentActorId: string
  currentAccountId?: string
  database: {
    getActorsForAccount: (params: {
      accountId: string
    }) => Promise<Array<{ id: string }>>
  }
}): Promise<boolean> => {
  const batchActorId = getSingleBatchActorId(files)
  if (!batchActorId) {
    return false
  }

  if (batchActorId === currentActorId) {
    return true
  }

  if (!currentAccountId) {
    return false
  }

  const accountActors = await database.getActorsForAccount({
    accountId: currentAccountId
  })

  return accountActors.some((actor) => actor.id === batchActorId)
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFitnessImportBatch',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { batchId } = (await context.params) ?? { batchId: undefined }
    const { currentActor, database } = context

    if (!batchId) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    let files = await database.getFitnessFilesByBatchId({ batchId })
    if (files.length === 0) {
      const archiveSourceBatchId = getArchiveSourceBatchId(batchId)
      if (archiveSourceBatchId) {
        files = await database.getFitnessFilesByBatchId({
          batchId: archiveSourceBatchId
        })
      }
    }
    if (files.length === 0) {
      return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
    }

    const hasAccess = await isBatchOwnedByCurrentAccount({
      files,
      currentActorId: currentActor.id,
      currentAccountId: currentActor.account?.id,
      database
    })
    if (!hasAccess) {
      return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
    }

    const summary = summarizeBatch(files)

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        batchId,
        status: summary.status,
        summary: {
          total: summary.total,
          pending: summary.pending,
          completed: summary.completed,
          failed: summary.failed
        },
        files: files.map((item) => ({
          id: item.id,
          actorId: item.actorId,
          fileName: item.fileName,
          fileType: item.fileType,
          statusId: item.statusId ?? null,
          isPrimary: item.isPrimary ?? true,
          importStatus: item.importStatus ?? 'pending',
          importError: item.importError ?? null,
          activityStartTime: item.activityStartTime ?? null,
          processingStatus: item.processingStatus ?? 'pending'
        }))
      }
    })
  })
)

export const POST = traceApiRoute(
  'retryFitnessImportBatch',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { batchId } = (await context.params) ?? { batchId: undefined }
    const { currentActor, database } = context

    if (!batchId) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const files = await database.getFitnessFilesByBatchId({ batchId })
    if (files.length === 0) {
      return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
    }

    const batchActorId = getSingleBatchActorId(files)
    if (!batchActorId) {
      return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
    }

    const hasAccess = await isBatchOwnedByCurrentAccount({
      files,
      currentActorId: currentActor.id,
      currentAccountId: currentActor.account?.id,
      database
    })
    if (!hasAccess) {
      return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
    }

    const parsed = (await req.json().catch(() => ({}))) as {
      visibility?: string
    }
    const visibility = parsed.visibility ?? 'public'

    const visibilityParsed = Visibility.safeParse(visibility)
    if (!visibilityParsed.success) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const retriableFiles = files
      .filter((item) => getBatchFileState(item) === 'failed')
      .map((item) => ({
        file: item,
        importStatus: item.importStatus ?? 'pending',
        importError: item.importError ?? null,
        processingStatus: item.processingStatus ?? 'pending'
      }))

    if (retriableFiles.length === 0) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          batchId,
          retried: 0
        }
      })
    }

    const retriableFileIds = retriableFiles.map(({ file }) => file.id)
    const overlapFitnessFileIds = files
      .filter(
        (item) =>
          getBatchFileState(item) === 'completed' && Boolean(item.statusId)
      )
      .map((item) => item.id)

    await Promise.all([
      database.updateFitnessFilesImportStatus({
        fitnessFileIds: retriableFileIds,
        importStatus: 'pending'
      }),
      database.updateFitnessFilesProcessingStatus({
        fitnessFileIds: retriableFileIds,
        processingStatus: 'pending'
      })
    ])

    try {
      await getQueue().publish({
        id: getHashFromString(
          `${batchActorId}:fitness-import-retry:${batchId}`
        ),
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: batchActorId,
          batchId,
          fitnessFileIds: retriableFileIds,
          overlapFitnessFileIds,
          visibility: visibilityParsed.data
        }
      })
    } catch (error) {
      const nodeError = error as Error

      await Promise.all(
        retriableFiles.map(async (item) => {
          await Promise.all([
            database.updateFitnessFileImportStatus(
              item.file.id,
              item.importStatus,
              item.importError ?? undefined
            ),
            database.updateFitnessFileProcessingStatus(
              item.file.id,
              item.processingStatus
            )
          ])
        })
      )

      logger.error({
        message: 'Failed to queue retry for fitness imports',
        actorId: batchActorId,
        batchId,
        retried: retriableFiles.length,
        error: nodeError.message
      })

      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    logger.info({
      message: 'Queued retry for failed fitness imports',
      actorId: batchActorId,
      batchId,
      retried: retriableFiles.length
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        batchId,
        retried: retriableFiles.length
      }
    })
  })
)
