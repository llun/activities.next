import { SpanStatusCode, trace } from '@opentelemetry/api'
import crypto from 'crypto'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/config/fitnessStorage'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getPresignedFitnessFileUrl } from '@/lib/services/fitness-files'
import { QuotaExceededError } from '@/lib/services/fitness-files/errors'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import { getStravaArchiveSourceBatchId } from '@/lib/services/strava/archiveImport'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const PresignedArchiveInput = z.object({
  fileName: z
    .string()
    .refine(
      (name) => name.toLowerCase().endsWith('.zip'),
      'Only .zip archive files are accepted'
    ),
  contentType: z.string().default('application/zip'),
  size: z
    .number()
    .positive()
    .refine((value) => {
      const config = getConfig()
      return (
        value <=
        (config.fitnessStorage?.maxFileSize ?? DEFAULT_FITNESS_MAX_FILE_SIZE)
      )
    }, 'File is larger than the limit.')
})

export const POST = traceApiRoute(
  'getStravaArchivePresignedUrl',
  async (req) => {
    const database = getDatabase()
    const session = await getServerAuthSession()

    if (!database || !session?.user?.email) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    // Manually authenticated cookie-session mutation: apply the same CSRF
    // same-origin proof as AuthenticatedGuard.
    if (!hasSameOriginProof(req)) {
      return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    try {
      const activeImport = await database.getActiveStravaArchiveImportByActor({
        actorId: currentActor.id
      })
      if (activeImport) {
        return apiErrorResponse(HTTP_STATUS.CONFLICT)
      }

      const parsed = PresignedArchiveInput.safeParse(
        await req.json().catch(() => null)
      )
      if (!parsed.success) {
        return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      }
      const input = parsed.data

      const archiveId = crypto.randomUUID()
      const sourceBatchId = getStravaArchiveSourceBatchId(archiveId)

      const presigned = await getPresignedFitnessFileUrl(
        database,
        currentActor,
        {
          fileName: input.fileName,
          contentType: input.contentType,
          size: input.size,
          importBatchId: sourceBatchId,
          description: 'Strava archive import source'
        }
      )

      if (!presigned) {
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          presigned: {
            url: presigned.url,
            fitnessFileId: presigned.fitnessFileId,
            archiveId
          }
        }
      })
    } catch (error) {
      const span = trace.getActiveSpan()
      if (span) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error))
        )
        span.setStatus({ code: SpanStatusCode.ERROR })
      }

      logger.error({
        message: 'Fail to get strava archive presigned url',
        error
      })

      if (error instanceof QuotaExceededError) {
        return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      }
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }
)
