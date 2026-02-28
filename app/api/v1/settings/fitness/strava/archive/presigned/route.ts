import crypto from 'crypto'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { getPresignedFitnessFileUrl } from '@/lib/services/fitness-files'
import { QuotaExceededError } from '@/lib/services/fitness-files/errors'
import { getStravaArchiveSourceBatchId } from '@/lib/services/strava/archiveImport'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
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
  size: z.number().positive()
})

export const POST = traceApiRoute(
  'getStravaArchivePresignedUrl',
  async (req) => {
    const database = getDatabase()
    const session = await getServerSession(getAuthOptions())

    if (!database || !session?.user?.email) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    try {
      const content = await req.json()
      const input = PresignedArchiveInput.parse(content)

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
            fields: presigned.fields,
            fitnessFileId: presigned.fitnessFileId,
            archiveId
          }
        }
      })
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      }
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }
  }
)
