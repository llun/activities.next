import { z } from 'zod'

import { IMPORT_FITNESS_FILES_JOB_NAME } from '@/lib/jobs/names'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
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

const summarizeBatch = (files: FitnessFile[]) => {
  const total = files.length
  const pending = files.filter((item) => item.importStatus === 'pending').length
  const completed = files.filter(
    (item) => item.importStatus === 'completed'
  ).length
  const failed = files.filter((item) => item.importStatus === 'failed').length

  let status: BatchStatus = 'completed'
  if (failed > 0 && completed > 0) {
    status = 'partially_failed'
  } else if (failed > 0 && completed === 0) {
    status = 'failed'
  } else if (pending > 0) {
    status = 'pending'
  }

  return {
    status,
    total,
    pending,
    completed,
    failed
  }
}

const isBatchOwnedByActor = (
  files: FitnessFile[],
  currentActorId: string
): boolean => {
  return files.every((item) => item.actorId === currentActorId)
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

    const files = await database.getFitnessFilesByBatchId({ batchId })
    if (files.length === 0) {
      return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
    }

    if (!isBatchOwnedByActor(files, currentActor.id)) {
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

    if (!isBatchOwnedByActor(files, currentActor.id)) {
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

    const failedFiles = files.filter((item) => item.importStatus === 'failed')
    if (failedFiles.length === 0) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          batchId,
          retried: 0
        }
      })
    }

    await Promise.all(
      failedFiles.map(async (item) => {
        await Promise.all([
          database.updateFitnessFileImportStatus(item.id, 'pending'),
          database.updateFitnessFileProcessingStatus(item.id, 'pending')
        ])
      })
    )

    await getQueue().publish({
      id: getHashFromString(
        `${currentActor.id}:fitness-import-retry:${batchId}`
      ),
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: currentActor.id,
        batchId,
        fitnessFileIds: failedFiles.map((item) => item.id),
        visibility: visibilityParsed.data
      }
    })

    logger.info({
      message: 'Queued retry for failed fitness imports',
      actorId: currentActor.id,
      batchId,
      retried: failedFiles.length
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        batchId,
        retried: failedFiles.length
      }
    })
  })
)
