import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getStatusFitnessActivity',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId) return apiErrorResponse(404)

    const statusId = decodeURIComponent(encodedStatusId)

    try {
      const activity = await database.getFitnessActivityByStatusId({
        statusId
      })

      if (!activity) {
        return apiErrorResponse(404)
      }

      // Return only the relevant fields for display
      return apiResponse({
        req,
        allowedMethods: ['GET'],
        data: {
          id: activity.id,
          type: activity.type,
          name: activity.name,
          distance: activity.distance,
          movingTime: activity.movingTime,
          averageSpeed: activity.averageSpeed,
          averageHeartrate: activity.averageHeartrate,
          averageWatts: activity.averageWatts,
          totalElevationGain: activity.totalElevationGain,
          calories: activity.calories
        }
      })
    } catch (error) {
      logger.error({
        err: error,
        message: 'Error fetching fitness activity',
        statusId
      })
      return apiErrorResponse(500)
    }
  })
)
