import crypto from 'crypto'
import { z } from 'zod'

import { IMPORT_STRAVA_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import {
  deleteFitnessFile,
  saveFitnessFile
} from '@/lib/services/fitness-files'
import { QuotaExceededError } from '@/lib/services/fitness-files/errors'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import {
  getStravaArchiveImportBatchId,
  getStravaArchiveSourceBatchId
} from '@/lib/services/strava/archiveImport'
import { StravaArchiveImport } from '@/lib/types/database/stravaArchiveImport'
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

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST,
  HttpMethod.enum.PATCH
]

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])
const ArchiveImportAction = z.enum(['retry', 'cancel'])

const ACCEPTED_ZIP_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream'
]

const isZipArchiveFile = (file: File): boolean => {
  const lowerName = file.name.toLowerCase()
  if (!lowerName.endsWith('.zip')) {
    return false
  }

  if (!file.type) {
    return true
  }

  return ACCEPTED_ZIP_MIME_TYPES.includes(file.type.toLowerCase())
}

const toActiveImportResponse = (activeImport: StravaArchiveImport) => {
  return {
    id: activeImport.id,
    archiveId: activeImport.archiveId,
    archiveFitnessFileId: activeImport.archiveFitnessFileId,
    batchId: activeImport.batchId,
    visibility: activeImport.visibility,
    status: activeImport.status,
    nextActivityIndex: activeImport.nextActivityIndex,
    mediaAttachmentRetry: activeImport.mediaAttachmentRetry,
    totalActivitiesCount: activeImport.totalActivitiesCount ?? null,
    completedActivitiesCount: activeImport.completedActivitiesCount,
    failedActivitiesCount: activeImport.failedActivitiesCount,
    firstFailureMessage: activeImport.firstFailureMessage ?? null,
    lastError: activeImport.lastError ?? null,
    pendingMediaActivitiesCount: activeImport.pendingMediaActivities.length,
    createdAt: activeImport.createdAt,
    updatedAt: activeImport.updatedAt
  }
}

const isActorActiveImportConflictError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return (
    message.includes('strava_archive_imports_actor_active_idx') ||
    message.includes('strava_archive_imports_actorid_unique') ||
    message.includes('unique constraint') ||
    message.includes('duplicate key value')
  )
}

const queueStravaArchiveImportJob = async ({
  importId,
  actorId,
  archiveId,
  archiveFitnessFileId,
  batchId,
  visibility,
  nextActivityIndex,
  pendingMediaActivities,
  mediaAttachmentRetry,
  totalActivitiesCount,
  completedActivitiesCount,
  failedActivitiesCount,
  firstFailureMessage
}: {
  importId: string
  actorId: string
  archiveId: string
  archiveFitnessFileId: string
  batchId: string
  visibility: 'public' | 'unlisted' | 'private' | 'direct'
  nextActivityIndex: number
  pendingMediaActivities: StravaArchiveImport['pendingMediaActivities']
  mediaAttachmentRetry: number
  totalActivitiesCount?: number
  completedActivitiesCount: number
  failedActivitiesCount: number
  firstFailureMessage?: string
}) => {
  const enqueueNonce = Date.now().toString(36)

  await getQueue().publish({
    id: getHashFromString(
      `${actorId}:strava-archive:${archiveId}:import:${importId}:${nextActivityIndex}:${mediaAttachmentRetry}:${enqueueNonce}`
    ),
    name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
    data: {
      importId,
      actorId,
      archiveId,
      archiveFitnessFileId,
      batchId,
      visibility,
      nextActivityIndex,
      pendingMediaActivities,
      mediaAttachmentRetry,
      ...(totalActivitiesCount !== undefined ? { totalActivitiesCount } : null),
      completedActivitiesCount,
      failedActivitiesCount,
      ...(firstFailureMessage ? { firstFailureMessage } : null)
    }
  })
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getActiveStravaArchiveImport',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const activeImport = await database.getActiveStravaArchiveImportByActor({
      actorId: currentActor.id
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        activeImport: activeImport ? toActiveImportResponse(activeImport) : null
      }
    })
  })
)

export const POST = traceApiRoute(
  'startStravaArchiveImport',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    let archiveFileId: string | null = null
    let archiveImportId: string | null = null

    try {
      const existingImport = await database.getActiveStravaArchiveImportByActor(
        {
          actorId: currentActor.id
        }
      )
      if (existingImport) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          responseStatusCode: HTTP_STATUS.CONFLICT,
          data: {
            error:
              'A Strava archive import is already active for this actor. Retry or cancel it before starting a new import.',
            activeImport: toActiveImportResponse(existingImport)
          }
        })
      }

      const contentType = req.headers.get('content-type') ?? ''

      if (contentType.includes('application/json')) {
        const body = (await req.json()) as {
          fitnessFileId?: unknown
          archiveId?: unknown
          visibility?: unknown
        }

        if (
          typeof body.fitnessFileId !== 'string' ||
          !body.fitnessFileId ||
          typeof body.archiveId !== 'string' ||
          !body.archiveId
        ) {
          return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
        }

        const visibilityResult = Visibility.safeParse(body.visibility)
        if (!visibilityResult.success) {
          return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
        }

        const fitnessFile = await database.getFitnessFile({
          id: body.fitnessFileId
        })
        if (!fitnessFile || fitnessFile.actorId !== currentActor.id) {
          return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
        }

        const archiveId = body.archiveId
        const batchId = getStravaArchiveImportBatchId(archiveId)
        const importId = crypto.randomUUID()

        archiveFileId = fitnessFile.id

        const importState = await database.createStravaArchiveImport({
          id: importId,
          actorId: currentActor.id,
          archiveId,
          archiveFitnessFileId: fitnessFile.id,
          batchId,
          visibility: visibilityResult.data
        })
        archiveImportId = importState.id

        await queueStravaArchiveImportJob({
          importId: importState.id,
          actorId: currentActor.id,
          archiveId,
          archiveFitnessFileId: fitnessFile.id,
          batchId,
          visibility: visibilityResult.data,
          nextActivityIndex: 0,
          pendingMediaActivities: [],
          mediaAttachmentRetry: 0,
          completedActivitiesCount: 0,
          failedActivitiesCount: 0
        })

        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            archiveId,
            batchId,
            importId: importState.id
          }
        })
      }

      const formData = await req.formData()
      const archiveRaw = formData.get('archive')
      const visibilityRaw = String(formData.get('visibility') ?? 'public')
      const actorIdRaw = String(formData.get('actorId') ?? '').trim()
      const visibilityResult = Visibility.safeParse(visibilityRaw)

      if (!visibilityResult.success) {
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }

      if (!(archiveRaw instanceof File) || archiveRaw.size <= 0) {
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }

      if (!isZipArchiveFile(archiveRaw)) {
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }

      // Archive import is intentionally restricted to the actor in the current
      // session, matching the settings UI.
      if (actorIdRaw.length > 0 && actorIdRaw !== currentActor.id) {
        return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
      }

      const archiveId = crypto.randomUUID()
      const sourceBatchId = getStravaArchiveSourceBatchId(archiveId)
      const batchId = getStravaArchiveImportBatchId(archiveId)
      const importId = crypto.randomUUID()

      const storedArchive = await saveFitnessFile(database, currentActor, {
        file: archiveRaw,
        importBatchId: sourceBatchId,
        description: 'Strava archive import source'
      })
      if (!storedArchive) {
        throw new Error('Failed to save Strava archive file')
      }

      archiveFileId = storedArchive.id

      const importState = await database.createStravaArchiveImport({
        id: importId,
        actorId: currentActor.id,
        archiveId,
        archiveFitnessFileId: storedArchive.id,
        batchId,
        visibility: visibilityResult.data
      })
      archiveImportId = importState.id

      await queueStravaArchiveImportJob({
        importId: importState.id,
        actorId: currentActor.id,
        archiveId,
        archiveFitnessFileId: storedArchive.id,
        batchId,
        visibility: visibilityResult.data,
        nextActivityIndex: 0,
        pendingMediaActivities: [],
        mediaAttachmentRetry: 0,
        completedActivitiesCount: 0,
        failedActivitiesCount: 0
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          archiveId,
          batchId,
          importId: importState.id
        }
      })
    } catch (error) {
      if (archiveFileId) {
        try {
          const deleted = await deleteFitnessFile(database, archiveFileId)
          if (!deleted) {
            logger.error({
              message:
                'Failed to rollback archive file after queue publish failure',
              actorId: currentActor.id,
              archiveFileId
            })
          }
        } catch (rollbackError) {
          const nodeError = rollbackError as Error
          logger.error({
            message:
              'Failed to rollback archive file after queue publish failure',
            actorId: currentActor.id,
            archiveFileId,
            error: nodeError.message
          })
        }
      }
      if (archiveImportId) {
        await database.deleteStravaArchiveImport({
          id: archiveImportId
        })
      }

      if (isActorActiveImportConflictError(error)) {
        const activeImport = await database.getActiveStravaArchiveImportByActor(
          {
            actorId: currentActor.id
          }
        )

        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          responseStatusCode: HTTP_STATUS.CONFLICT,
          data: {
            error:
              'A Strava archive import is already active for this actor. Retry or cancel it before starting a new import.',
            activeImport: activeImport
              ? toActiveImportResponse(activeImport)
              : null
          }
        })
      }

      const nodeError = error as Error
      logger.error({
        message: 'Failed to start Strava archive import',
        actorId: currentActor.id,
        error: nodeError.message
      })

      if (nodeError instanceof QuotaExceededError) {
        return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      }

      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)

export const PATCH = traceApiRoute(
  'manageActiveStravaArchiveImport',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const payload = (await req.json().catch(() => ({}))) as {
      action?: string
    }
    const actionResult = ArchiveImportAction.safeParse(payload.action)
    if (!actionResult.success) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const activeImport = await database.getActiveStravaArchiveImportByActor({
      actorId: currentActor.id
    })
    if (!activeImport) {
      return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
    }

    if (actionResult.data === 'retry') {
      if (activeImport.status !== 'failed') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          responseStatusCode: HTTP_STATUS.CONFLICT,
          data: {
            error: 'Only failed archive imports can be retried.',
            activeImport: toActiveImportResponse(activeImport)
          }
        })
      }

      const archiveFile = await database.getFitnessFile({
        id: activeImport.archiveFitnessFileId
      })
      if (!archiveFile || archiveFile.actorId !== currentActor.id) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          responseStatusCode: HTTP_STATUS.CONFLICT,
          data: {
            error:
              'Archive source file is unavailable. Cancel this import and upload a new archive.'
          }
        })
      }

      const previousLastError = activeImport.lastError ?? null

      await database.updateStravaArchiveImport({
        id: activeImport.id,
        status: 'importing',
        lastError: null
      })

      await Promise.all([
        database.updateFitnessFileImportStatus(
          activeImport.archiveFitnessFileId,
          'pending'
        ),
        database.updateFitnessFileProcessingStatus(
          activeImport.archiveFitnessFileId,
          'pending'
        )
      ])

      try {
        await queueStravaArchiveImportJob({
          importId: activeImport.id,
          actorId: activeImport.actorId,
          archiveId: activeImport.archiveId,
          archiveFitnessFileId: activeImport.archiveFitnessFileId,
          batchId: activeImport.batchId,
          visibility: activeImport.visibility,
          nextActivityIndex: activeImport.nextActivityIndex,
          pendingMediaActivities: activeImport.pendingMediaActivities,
          mediaAttachmentRetry: activeImport.mediaAttachmentRetry,
          totalActivitiesCount: activeImport.totalActivitiesCount,
          completedActivitiesCount: activeImport.completedActivitiesCount,
          failedActivitiesCount: activeImport.failedActivitiesCount,
          firstFailureMessage: activeImport.firstFailureMessage
        })
      } catch (error) {
        const nodeError = error as Error

        await database.updateStravaArchiveImport({
          id: activeImport.id,
          status: 'failed',
          lastError: previousLastError ?? nodeError.message
        })

        await Promise.all([
          database.updateFitnessFileImportStatus(
            activeImport.archiveFitnessFileId,
            'failed',
            previousLastError ?? nodeError.message
          ),
          database.updateFitnessFileProcessingStatus(
            activeImport.archiveFitnessFileId,
            'failed'
          )
        ])

        logger.error({
          message: 'Failed to queue Strava archive retry',
          actorId: currentActor.id,
          archiveImportId: activeImport.id,
          error: nodeError.message
        })

        return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      }

      const refreshedImport =
        await database.getActiveStravaArchiveImportByActor({
          actorId: currentActor.id
        })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          success: true,
          activeImport: refreshedImport
            ? toActiveImportResponse(refreshedImport)
            : null
        }
      })
    }

    const archiveFile = await database.getFitnessFile({
      id: activeImport.archiveFitnessFileId
    })
    if (archiveFile && archiveFile.actorId === currentActor.id) {
      const deleted = await deleteFitnessFile(
        database,
        archiveFile.id,
        archiveFile
      )
      if (!deleted) {
        logger.error({
          message: 'Failed to delete Strava archive source file on cancel',
          actorId: currentActor.id,
          archiveImportId: activeImport.id,
          archiveFitnessFileId: archiveFile.id
        })
        return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      }
    }

    await database.updateStravaArchiveImport({
      id: activeImport.id,
      status: 'cancelled',
      lastError: 'Cancelled by user',
      resolvedAt: Date.now()
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        success: true,
        cancelled: true
      }
    })
  })
)
