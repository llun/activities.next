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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

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

const toArchiveStorageFile = (archiveFile: File): File => {
  // Fitness storage currently supports only fit/gpx/tcx extensions.
  // Keep the original ZIP MIME type and use a compatible extension until
  // storage supports a dedicated archive file type.
  // TODO: remove this extension workaround once archive uploads are first-class.
  const baseName = archiveFile.name.replace(/\.zip$/i, '')
  return new File([archiveFile], `${baseName}.fit`, {
    type: archiveFile.type || 'application/zip'
  })
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'startStravaArchiveImport',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    let archiveFileId: string | null = null

    try {
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

      // Keep the original archive MIME type while storing in fitness storage.
      const archiveStorageFile = toArchiveStorageFile(archiveRaw)

      const storedArchive = await saveFitnessFile(database, currentActor, {
        file: archiveStorageFile,
        importBatchId: sourceBatchId,
        description: 'Strava archive import source'
      })
      if (!storedArchive) {
        throw new Error('Failed to save Strava archive file')
      }

      archiveFileId = storedArchive.id

      await getQueue().publish({
        id: getHashFromString(
          `${currentActor.id}:strava-archive:${archiveId}:import`
        ),
        name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
        data: {
          actorId: currentActor.id,
          archiveId,
          archiveFitnessFileId: storedArchive.id,
          batchId,
          visibility: visibilityResult.data
        }
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          archiveId,
          batchId
        }
      })
    } catch (error) {
      if (archiveFileId) {
        await deleteFitnessFile(database, archiveFileId).catch(() => {
          logger.error({
            message:
              'Failed to rollback archive file after queue publish failure',
            actorId: currentActor.id,
            archiveFileId
          })
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
