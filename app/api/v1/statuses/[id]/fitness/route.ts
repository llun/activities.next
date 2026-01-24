import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { logger } from '@/lib/utils/logger'
import { apiResponse, apiErrorResponse } from '@/lib/utils/response'

export const GET = traceApiRoute(
  'getStatusFitnessActivity',
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const params = await context.params
    const statusId = decodeURIComponent(params.id)

    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

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
  }
)
