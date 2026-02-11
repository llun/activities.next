import { NextRequest } from 'next/server'

import { getFitnessFile } from '@/lib/services/fitness-files'
import { logger } from '@/lib/utils/logger'
import { StatusCode, apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { getDatabase } from '@/lib/database'

export const GET = traceApiRoute(
  'getFitnessFile',
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const database = getDatabase()
    const { id } = await params

    try {
      const result = await getFitnessFile(database, id)

      if (!result) {
        logger.warn({ message: 'Fitness file not found', fileId: id })
        return apiErrorResponse(StatusCode.NotFound)
      }

      if (result.type === 'redirect') {
        return Response.redirect(result.redirectUrl, 302)
      }

      return new Response(result.buffer, {
        headers: {
          'Content-Type': result.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error retrieving fitness file',
        fileId: id,
        error: err.message
      })
      return apiErrorResponse(StatusCode.InternalServerError)
    }
  }
)
