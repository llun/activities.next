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

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'startStravaArchiveImport',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    let archiveFileId: string | null = null
    let targetActorId = currentActor.id

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

      let targetActor = currentActor
      if (actorIdRaw.length > 0 && actorIdRaw !== currentActor.id) {
        if (!currentActor.account) {
          return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
        }

        const accountActors = await database.getActorsForAccount({
          accountId: currentActor.account.id
        })
        const selectedActor =
          accountActors.find((actor) => actor.id === actorIdRaw) ?? null

        if (!selectedActor) {
          return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
        }

        targetActor = selectedActor
      }
      targetActorId = targetActor.id

      const archiveId = crypto.randomUUID()
      const sourceBatchId = getStravaArchiveSourceBatchId(archiveId)
      const batchId = getStravaArchiveImportBatchId(archiveId)

      // Store archive file in fitness storage so it counts toward quota usage.
      const archiveStorageFile = new File([archiveRaw], archiveRaw.name, {
        type: 'application/vnd.ant.fit'
      })

      const storedArchive = await saveFitnessFile(database, targetActor, {
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
          `${targetActor.id}:strava-archive:${archiveId}:import`
        ),
        name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
        data: {
          actorId: targetActor.id,
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
            actorId: targetActorId,
            archiveFileId
          })
        })
      }

      const nodeError = error as Error
      logger.error({
        message: 'Failed to start Strava archive import',
        actorId: targetActorId,
        error: nodeError.message
      })

      if (nodeError instanceof QuotaExceededError) {
        return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      }

      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)
